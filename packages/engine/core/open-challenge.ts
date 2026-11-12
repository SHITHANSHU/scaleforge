import type { ComponentRegistry } from "./registry";
import { validateGraph, type GraphDoc, type NodeDoc } from "./graph";
import { Simulation, type Snapshot } from "./simulation";
import type { Scenario } from "./scenario";
import type { ConfigRecord } from "./types";

// ---------- Public challenge definition (shown to the player) ----------

export type Level = "intermediate" | "advanced" | "senior" | "staff";

export interface FixedNode {
  id: string;
  kind: string;
  label?: string;
  config?: ConfigRecord;
  x: number; y: number; w?: number; h?: number;
  /** true = nothing about it can change; string[] = only these config keys are locked. */
  locked?: boolean | string[];
}

export interface OpenChallenge {
  schemaVersion: 2;
  kind: "open";
  id: string;
  title: string;
  category: string;
  level: Level;
  estimatedMinutes: number;
  tags: string[];
  summary: string;
  statement: { situation: string; symptoms: string[]; requirements: string[]; constraints: string[] };
  background?: string;
  learningObjectives: string[];
  references: { title: string; url?: string }[];
  resources: {
    /** Component kinds the player may place; omit for all. */
    allowed?: string[];
    maxNodes?: number;
    budget?: { maxCostPerHour: number };
    /** Pre-placed items (traffic sources, regions, a legacy system…). */
    fixed: FixedNode[];
    fixedEdges?: GraphDoc["edges"];
    /** Defaults applied when the player places a component, and fields locked per kind. */
    kindDefaults?: Record<string, ConfigRecord>;
    kindLocked?: Record<string, string[]>;
  };
  /** Scenarios the player can run and watch. */
  scenarios: { id: string; name: string; description: string; scenario: Scenario }[];
  /** What is being judged, in words. The numbers live in grading.json. */
  successCriteria: { id: string; label: string }[];
  /** Optional, progressively revealed. */
  hints?: string[];
}

// ---------- Grading definition (loaded when the player evaluates) ----------

export type Agg = "max" | "min" | "mean" | "last" | "first" | "settleSec";
export type Op = "<" | "<=" | ">" | ">=";

export interface OpenCriterion {
  id: string;
  label: string;
  /** Hard criteria must all pass for the design to pass, regardless of score. */
  hard?: boolean;
  weight?: number;
  /** Scenario id, or "all" (every scenario must satisfy it). */
  scenario: string;
  /** "e2e.p50|p95|p99|errorRate|availability|throughput|offered|retryRps|duplicateRate|costPerHour" or "<kind>.<metric>". */
  metric: string;
  /** How to reduce the time series over the window. Default: max for < / <=, min for > / >=. */
  agg?: Agg;
  /** How to reduce across several nodes of the same kind. Default: max (min for > / >=). */
  nodeAgg?: "max" | "min" | "sum";
  op: Op;
  value: number;
  /** Beyond `value` the score falls linearly to 0 at `limit` (partial credit for soft criteria). */
  limit?: number;
  after?: number;
  before?: number;
  /** For agg="settleSec": the threshold the metric must stay on the good side of; the result is seconds after `after`. */
  settle?: number;
  /** Which side is good for settleSec. Default: "above" for availability/throughput/goodput metrics, else "below". */
  settleWhen?: "above" | "below";
}

export interface Grading {
  schemaVersion: 2;
  passScore: number;
  /** Extra scenarios the player doesn't see until after evaluation (different seeds, timings, faults). */
  hiddenScenarios?: { id: string; name: string; scenario: Scenario }[];
  criteria: OpenCriterion[];
}

export interface OpenCriterionResult {
  criterion: OpenCriterion;
  scenario: string;
  actual: number;
  score: number; // 0..1
  pass: boolean;
}
export interface ScenarioRun { id: string; name: string; hidden: boolean; cost: number; error?: string }
export interface OpenGrade {
  valid: boolean;
  problems: string[];
  results: OpenCriterionResult[];
  runs: ScenarioRun[];
  score: number; // 0..100
  hardFailures: string[];
  budgetOk: boolean;
  pass: boolean;
}

const E2E: Record<string, (s: Snapshot) => number> = {
  "e2e.p50": (s) => s.global.p50, "e2e.p95": (s) => s.global.p95, "e2e.p99": (s) => s.global.p99,
  "e2e.errorRate": (s) => s.global.errorRate, "e2e.availability": (s) => 1 - s.global.errorRate,
  "e2e.throughput": (s) => s.global.throughputRps, "e2e.offered": (s) => s.global.offeredRps, "e2e.retryRps": (s) => s.global.retryRps,
  "e2e.duplicateRate": (s) => s.global.duplicateRate, "e2e.costPerHour": (s) => s.global.costPerHour,
  "e2e.retryRatio": (s) => (s.global.offeredRps > 0 ? s.global.retryRps / s.global.offeredRps : 0),
  "e2e.goodputRatio": (s) => (s.global.offeredRps > 0 ? s.global.throughputRps / s.global.offeredRps : 1),
};

function series(c: OpenCriterion, snaps: Snapshot[], kindOf: Record<string, string>): number[] {
  const lowerIsBetter = c.op === "<" || c.op === "<=";
  const win = snaps.filter((s) => s.time >= (c.after ?? 0) && s.time <= (c.before ?? Infinity));
  const pick = c.nodeAgg ?? (lowerIsBetter ? "max" : "min");
  return win.map((s) => {
    const f = E2E[c.metric];
    if (f) return f(s);
    const [kind, id] = c.metric.split(".") as [string, string];
    const vals = Object.entries(s.nodes).filter(([nid]) => kindOf[nid] === kind).map(([, m]) => m[id]).filter((v): v is number => typeof v === "number");
    if (!vals.length) return NaN;
    return pick === "sum" ? vals.reduce((a, b) => a + b, 0) : pick === "min" ? Math.min(...vals) : Math.max(...vals);
  });
}

function reduce(c: OpenCriterion, snaps: Snapshot[], kindOf: Record<string, string>): number {
  const lowerIsBetter = c.op === "<" || c.op === "<=";
  const xs = series(c, snaps, kindOf);
  if (xs.length === 0 || xs.some((v) => Number.isNaN(v))) return NaN; // unknown metric or no data: never passes vacuously
  const agg = c.agg ?? (lowerIsBetter ? "max" : "min");
  switch (agg) {
    case "max": return Math.max(...xs);
    case "min": return Math.min(...xs);
    case "mean": return xs.reduce((a, b) => a + b, 0) / xs.length;
    case "last": return xs[xs.length - 1]!;
    case "first": return xs[0]!;
    case "settleSec": {
      // seconds after `after` until the metric stays on the good side of `settle` for the rest of the window
      const thr = c.settle ?? c.value;
      const higherGood = c.settleWhen ? c.settleWhen === "above" : /availab|throughput|goodputRatio/i.test(c.metric);
      const bad = (v: number) => (higherGood ? v < thr : v > thr);
      const win = snaps.filter((s) => s.time >= (c.after ?? 0) && s.time <= (c.before ?? Infinity));
      let lastBad = -1;
      xs.forEach((v, i) => { if (bad(v)) lastBad = i; });
      if (lastBad === xs.length - 1) return Infinity;
      return lastBad < 0 ? 0 : win[lastBad + 1]!.time - (c.after ?? 0);
    }
  }
}

function judge(c: OpenCriterion, actual: number): { pass: boolean; score: number } {
  if (!Number.isFinite(actual)) {
    const pass = actual === -Infinity && (c.op === "<" || c.op === "<=") ? true : false;
    return { pass, score: 0 };
  }
  const pass = c.op === "<" ? actual < c.value : c.op === "<=" ? actual <= c.value : c.op === ">" ? actual > c.value : actual >= c.value;
  if (pass) return { pass, score: 1 };
  if (c.limit === undefined) return { pass, score: 0 };
  const span = Math.abs(c.limit - c.value) || 1;
  const miss = Math.abs(actual - c.value);
  return { pass, score: Math.max(0, 1 - miss / span) };
}

/** Does the design respect the challenge's resource rules? */
export function checkResources(ch: OpenChallenge, doc: GraphDoc, fixedIds: Set<string>): string[] {
  const problems: string[] = [];
  const placed = doc.nodes.filter((n) => !fixedIds.has(n.id));
  if (ch.resources.maxNodes !== undefined && placed.length > ch.resources.maxNodes) problems.push(`Uses ${placed.length} components; the limit is ${ch.resources.maxNodes}.`);
  if (ch.resources.allowed) for (const n of placed) if (!ch.resources.allowed.includes(n.kind)) problems.push(`${n.kind} is not available in this scenario.`);
  return problems;
}

export function lockViolationsOpen(ch: OpenChallenge, doc: GraphDoc, reg?: ComponentRegistry): string[] {
  const out: string[] = [];
  for (const f of ch.resources.fixed) {
    if (f.kind === "boundary") continue;
    const n = doc.nodes.find((x) => x.id === f.id);
    if (!n) { out.push(`${f.id} was removed`); continue; }
    // compare against the full effective config (defaults + what the challenge set), so keys the author didn't list can't be changed either
    const want = { ...(reg?.get(f.kind)?.defaults ?? {}), ...(f.config ?? {}) };
    if (n.kind !== f.kind && f.locked) out.push(`${f.id}.kind`);
    if (f.locked === true) { for (const [k, v] of Object.entries(want)) if (n.config[k] !== v) out.push(`${f.id}.${k}`); }
    else if (Array.isArray(f.locked)) for (const k of f.locked) if (n.config[k] !== want[k]) out.push(`${f.id}.${k}`);
  }
  for (const [kind, keys] of Object.entries(ch.resources.kindLocked ?? {})) {
    const base = ch.resources.kindDefaults?.[kind] ?? {};
    for (const n of doc.nodes) if (n.kind === kind) for (const k of keys) if (k in base && n.config[k] !== base[k]) out.push(`${n.id}.${k}`);
  }
  return out;
}

/**
 * Run a design against every scenario (public and hidden) and score it with the challenge's own criteria.
 * Deterministic: same design + challenge = same grade.
 */
export function gradeOpen(reg: ComponentRegistry, ch: OpenChallenge, grading: Grading, doc: GraphDoc): OpenGrade {
  const fixedIds = new Set(ch.resources.fixed.map((f) => f.id));
  const problems = [
    ...validateGraph(doc, reg).filter((i) => i.severity === "error").map((i) => i.message),
    ...checkResources(ch, doc, fixedIds),
    ...lockViolationsOpen(ch, doc, reg).map((l) => `Locked by the scenario: ${l}`),
  ];
  const kindOf = Object.fromEntries(doc.nodes.map((n: NodeDoc) => [n.id, n.kind]));
  const all = [
    ...ch.scenarios.map((s) => ({ id: s.id, name: s.name, hidden: false, scenario: s.scenario })),
    ...(grading.hiddenScenarios ?? []).map((s) => ({ ...s, hidden: true })),
  ];
  const snaps = new Map<string, Snapshot[]>();
  const runs: ScenarioRun[] = [];
  if (problems.length === 0) {
    for (const sc of all) {
      // cost is the peak spend, so temporary capacity (blue-green, surges) counts
      try { const r = new Simulation(reg, doc, sc.scenario).run(500); snaps.set(sc.id, r); runs.push({ id: sc.id, name: sc.name, hidden: sc.hidden, cost: Math.max(0, ...r.map((x) => x.global.costPerHour)) }); }
      catch (e) { problems.push(`Scenario "${sc.name}" could not run: ${(e as Error).message}`); }
    }
  }
  // a design that parks or discards most traffic must not look healthy just because nothing "failed"
  for (const [sid, sn] of snaps) {
    const offered = sn.reduce((a, x) => a + x.global.offeredRps, 0), served = sn.reduce((a, x) => a + x.global.throughputRps, 0);
    if (offered > 0 && served < 0.4 * offered) problems.push(`"${all.find((x) => x.id === sid)?.name ?? sid}": only ${Math.round((served / offered) * 100)}% of the offered traffic was served end to end.`);
  }
  const results: OpenCriterionResult[] = [];
  if (problems.length === 0) {
    for (const c of grading.criteria) {
      const targets = c.scenario === "all" ? all.map((s) => s.id) : [c.scenario];
      for (const sid of targets) {
        const sn = snaps.get(sid);
        if (!sn) { problems.push(`Criterion "${c.label}" refers to an unknown scenario "${sid}"`); continue; }
        const actual = reduce(c, sn, kindOf);
        results.push({ criterion: c, scenario: sid, actual, ...judge(c, actual) });
      }
    }
  }
  const cost = Math.max(0, ...runs.map((r) => r.cost));
  const budgetOk = !ch.resources.budget || cost <= ch.resources.budget.maxCostPerHour;
  if (!budgetOk) problems.push(`Cost $${cost.toFixed(2)}/h exceeds the $${ch.resources.budget!.maxCostPerHour}/h budget.`);
  // per-criterion score = mean over the scenarios it applies to (the worst scenario for "all" must still pass)
  const byId = new Map<string, OpenCriterionResult[]>();
  for (const r of results) { const l = byId.get(r.criterion.id) ?? []; l.push(r); byId.set(r.criterion.id, l); }
  let wsum = 0, ssum = 0;
  const hardFailures: string[] = [];
  for (const c of grading.criteria) {
    const rs = byId.get(c.id) ?? [];
    if (rs.length === 0) continue;
    const w = c.weight ?? 1;
    const sc = c.scenario === "all" ? Math.min(...rs.map((r) => r.score)) : rs.reduce((a, r) => a + r.score, 0) / rs.length;
    wsum += w; ssum += w * sc;
    if (c.hard && !rs.every((r) => r.pass)) hardFailures.push(c.label);
  }
  let score = wsum > 0 ? (ssum / wsum) * 100 : 0;
  if (hardFailures.length > 0) score = Math.min(score, grading.passScore - 1); // a score can't look passable while a must-have fails
  const valid = problems.length === 0;
  return { valid, problems, results, runs, score, hardFailures, budgetOk, pass: valid && hardFailures.length === 0 && score >= grading.passScore };
}
