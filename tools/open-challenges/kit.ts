import { mkdirSync, writeFileSync } from "node:fs";
import { createDefaultRegistry, type Scenario, type OpenChallenge, type Grading, type GraphDoc } from "../../packages/engine/index";

export const reg = createDefaultRegistry();
export type Cfg = Record<string, number | string | boolean>;
/** [id, kind, x, y, config?, parentId?] */
export type N = [id: string, kind: string, x: number, y: number, cfg?: Cfg, parentId?: string, label?: string];
/** [from, fromPort, to, toPort, latencyMs?] */
export type E = [from: string, fromPort: string, to: string, toPort: string, latencyMs?: number];

/** `patch` edits config on fixed nodes; `drop` removes fixed edges by id. */
export interface Design { nodes: N[]; edges: E[]; patch?: Record<string, Cfg>; drop?: string[] }
export interface Spec {
  challenge: OpenChallenge;
  grading: Grading;
  writeup: string;
  /** A design that satisfies the challenge. */
  reference: Design;
  /** Other valid architectures (must also pass). */
  alternatives?: Record<string, Design>;
  /** Plausible attempts that must NOT pass. */
  attempts: Record<string, Design>;
}

/** The fixed traffic source: locked, so players can't dodge the load. */
export const users = (cfg: Cfg = {}, x = 0, y = 220) => ({ id: "users", kind: "client", label: "Users", x, y, locked: true as const, config: { ...reg.get("client")!.defaults, ...cfg } });

/** Build an engine doc (+ UI positions) from compact node/edge lists, merging in the challenge's fixed nodes and kind defaults. */
export function toDoc(ch: OpenChallenge, d: Design): GraphDoc & { positions: Record<string, { x: number; y: number }> } {
  const regionOf = (x: number, y: number) => ch.resources.fixed.find((f) => f.kind === "boundary" && x >= f.x && x <= f.x + (f.w ?? 0) && y >= f.y && y <= f.y + (f.h ?? 0))?.id;
  const nodes = [
    ...ch.resources.fixed.filter((f) => f.kind !== "boundary").map((f) => ({ id: f.id, kind: f.kind, label: f.label, config: { ...reg.get(f.kind)!.defaults, ...(f.config ?? {}), ...(d.patch?.[f.id] ?? {}) }, parentId: regionOf(f.x, f.y), x: f.x, y: f.y })),
    ...d.nodes.map(([id, kind, x, y, cfg, parentId, label]) => ({ id, kind, label, config: { ...reg.get(kind)!.defaults, ...(ch.resources.kindDefaults?.[kind] ?? {}), ...(cfg ?? {}) }, parentId: parentId ?? regionOf(x, y), x, y })),
  ];
  const kindOf = Object.fromEntries(nodes.map((n) => [n.id, n.kind]));
  const edges = [
    ...(ch.resources.fixedEdges ?? []).filter((e) => !(d.drop ?? []).includes(e.id)),
    ...d.edges.map(([from, fp, to, tp, lat], i) => {
      const a = reg.get(kindOf[from]!)!, b = reg.get(kindOf[to]!)!;
      const out = a.ports.find((p) => p.id === fp), inn = b.ports.find((p) => p.id === tp);
      if (!out || !inn) throw new Error(`bad edge ${from}.${fp} → ${to}.${tp}`);
      const protocol = out.protocols.find((p) => inn.protocols.includes(p));
      if (!protocol) throw new Error(`no shared protocol ${from}.${fp} → ${to}.${tp}`);
      return { id: `e${i + 1}`, from, fromPort: fp, to, toPort: tp, protocol, latencyMs: lat ?? 1 };
    }),
  ];
  return { nodes: nodes.map(({ x: _x, y: _y, ...n }) => n), edges, positions: Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }])) };
}

export const sc = (name: string, traffic: Scenario["traffic"], durationSec: number, faults: Scenario["faults"] = [], extra: Partial<Scenario> = {}): Scenario => ({ name, durationSec, seed: 42, traffic, faults, ...extra });
export const flat = (rps: number): Scenario["traffic"] => ({ type: "constant", rps });

export function write(spec: Spec) {
  const id = spec.challenge.id;
  const dir = `challenges/open/${id}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/challenge.json`, JSON.stringify(spec.challenge, null, 2));
  writeFileSync(`${dir}/grading.json`, JSON.stringify(spec.grading, null, 2));
  writeFileSync(`${dir}/writeup.md`, spec.writeup.trim() + "\n");
  const asDesign = (name: string, d: Design) => {
    const doc = toDoc(spec.challenge, d);
    return { schemaVersion: 1, id: `${id}-${name}`, name: `${spec.challenge.title} (${name})`, nodes: doc.nodes.map((n) => ({ ...n, ...doc.positions[n.id]! })), edges: doc.edges, scenario: spec.challenge.scenarios[0]!.scenario, updatedAt: 0 };
  };
  writeFileSync(`${dir}/reference.design.json`, JSON.stringify(asDesign("reference", spec.reference), null, 2));
  for (const [k, d] of Object.entries(spec.alternatives ?? {})) writeFileSync(`${dir}/alt-${k}.design.json`, JSON.stringify(asDesign(k, d), null, 2));
  for (const [k, d] of Object.entries(spec.attempts)) writeFileSync(`${dir}/attempt-${k}.design.json`, JSON.stringify(asDesign(k, d), null, 2));
}
