import type { ComponentRegistry } from "./registry";
import type { GraphDoc } from "./graph";
import { Simulation, type Snapshot } from "./simulation";
import type { Scenario } from "./scenario";

export interface Criterion {
  /** "e2e.p99" | "e2e.errorRate" | "e2e.throughput" | "cost.perHour" | "<kind>.<metricId>" (worst node of that kind). */
  metric: string;
  op: "<" | "<=" | ">" | ">=";
  value: number;
  /** Only judge simulated time after this many seconds. */
  after?: number;
  label?: string;
}

export interface Challenge {
  id: string;
  title: string;
  level: "mid" | "senior" | "staff";
  tags: string[];
  summary: string;
  /** Node ids, or "nodeId.configKey" for a single field, the player may not change. */
  locked: string[];
  budget?: { maxCostPerHour: number };
  scenario: Scenario;
  criteria: Criterion[];
  hints: string[];
}

export interface CriterionResult { criterion: Criterion; actual: number; pass: boolean }
export interface Grade { pass: boolean; results: CriterionResult[]; budgetOk: boolean; cost: number }

const e2e: Record<string, (s: Snapshot) => number> = {
  "e2e.p50": (s) => s.global.p50, "e2e.p95": (s) => s.global.p95, "e2e.p99": (s) => s.global.p99,
  "e2e.errorRate": (s) => s.global.errorRate, "e2e.availability": (s) => 1 - s.global.errorRate, "e2e.duplicateRate": (s) => s.global.duplicateRate, "e2e.retryRatio": (s) => (s.global.offeredRps > 0 ? s.global.retryRps / s.global.offeredRps : 0), "e2e.throughput": (s) => s.global.throughputRps, "cost.perHour": (s) => s.global.costPerHour,
};

/** Worst-case value of a metric across the window, so `<` criteria use the max and `>` criteria the min. */
function measure(c: Criterion, snaps: Snapshot[], kindOf: Record<string, string>): number {
  const pick = c.op === "<" || c.op === "<=" ? Math.max : Math.min;
  const win = snaps.filter((s) => s.time >= (c.after ?? 0));
  if (!win.length) return NaN;
  const vals = win.map((s) => {
    if (e2e[c.metric]) return e2e[c.metric]!(s);
    const [kind, id] = c.metric.split(".") as [string, string];
    const nodes = Object.entries(s.nodes).filter(([nid]) => kindOf[nid] === kind).map(([, m]) => m[id] ?? NaN);
    return nodes.length ? pick(...nodes) : NaN;
  });
  return pick(...vals.filter((v) => !Number.isNaN(v)));
}

export function evaluate(ch: Challenge, snaps: Snapshot[], doc: GraphDoc): Grade {
  const kindOf = Object.fromEntries(doc.nodes.map((n) => [n.id, n.kind]));
  const results = ch.criteria.map((c) => {
    const actual = measure(c, snaps, kindOf);
    const pass = c.op === "<" ? actual < c.value : c.op === "<=" ? actual <= c.value : c.op === ">" ? actual > c.value : actual >= c.value;
    return { criterion: c, actual, pass: Number.isFinite(actual) && pass };
  });
  const cost = snaps.at(-1)?.global.costPerHour ?? 0;
  const budgetOk = !ch.budget || cost <= ch.budget.maxCostPerHour;
  return { pass: budgetOk && results.every((r) => r.pass), results, budgetOk, cost };
}

/** Run a design against a challenge with the challenge's fixed seed. Deterministic. */
export function gradeChallenge(reg: ComponentRegistry, ch: Challenge, doc: GraphDoc): Grade {
  const sim = new Simulation(reg, doc, ch.scenario);
  return evaluate(ch, sim.run(500), doc);
}

/** Which locked items differ between the starter and the player's design? */
export function lockViolations(ch: Challenge, starter: GraphDoc, player: GraphDoc): string[] {
  const out: string[] = [];
  for (const l of ch.locked) {
    const [id, key] = l.split(".") as [string, string | undefined];
    const a = starter.nodes.find((n) => n.id === id), b = player.nodes.find((n) => n.id === id);
    if (!b) { out.push(`${id} was removed`); continue; }
    if (!a) continue;
    const stable = (o: object) => JSON.stringify(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
    if (a.kind !== b.kind || (key ? a.config[key] !== b.config[key] : stable(a.config) !== stable(b.config))) out.push(l);
  }
  return out;
}
