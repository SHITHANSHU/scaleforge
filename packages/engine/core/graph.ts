import type { ConfigRecord, GraphView, Issue, PortSpec } from "./types";
import { type ComponentRegistry, validateConfig } from "./registry";

export interface NodeDoc {
  id: string;
  kind: string;
  /** Display name; defaults to the component name. */
  label?: string;
  config: ConfigRecord;
  /** Visual grouping only (VPC / AZ boxes). */
  parentId?: string;
}
export interface EdgeDoc {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  protocol: string;
  latencyMs?: number;
  /** Optional cap in items/s. */
  maxRps?: number;
}
export interface GraphDoc { nodes: NodeDoc[]; edges: EdgeDoc[] }

export type Compat = { ok: true; protocol: string } | { ok: false; reason: string };

/** Protocol preferred when several match: first of the source port's list that the target also speaks. */
export function checkConnection(
  reg: ComponentRegistry, fromKind: string, fromPort: string, toKind: string, toPort: string,
): Compat {
  const a = reg.get(fromKind), b = reg.get(toKind);
  if (!a || !b) return { ok: false, reason: "Unknown component" };
  const out = a.ports.find((p: PortSpec) => p.id === fromPort && p.direction === "out");
  const inn = b.ports.find((p: PortSpec) => p.id === toPort && p.direction === "in");
  if (!out) return { ok: false, reason: `${a.name} has no output "${fromPort}"` };
  if (!inn) return { ok: false, reason: `${b.name} has no input "${toPort}"` };
  const shared = out.protocols.find((p) => inn.protocols.includes(p));
  if (!shared) {
    const label = (ids: string[]) => ids.map((i) => reg.protocol(i)?.label ?? i).join(" / ");
    return { ok: false, reason: `${a.name} emits ${label(out.protocols)}, ${b.name} accepts ${label(inn.protocols)}` };
  }
  return { ok: true, protocol: shared };
}

export function validateGraph(doc: GraphDoc, reg: ComponentRegistry): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();

  for (const n of doc.nodes) {
    if (seen.has(n.id)) issues.push({ severity: "error", nodeId: n.id, message: `Duplicate node id ${n.id}` });
    seen.add(n.id);
    const def = reg.get(n.kind);
    if (!def) { issues.push({ severity: "error", nodeId: n.id, message: `Unknown component "${n.kind}" (not registered)` }); continue; }
    // older saved designs may lack fields added later; the simulator fills them from defaults, so validate the merged config
    for (const i of validateConfig(def.fields, { ...def.defaults, ...n.config })) issues.push({ ...i, nodeId: n.id });
  }

  const edgeIds = new Set<string>();
  for (const e of doc.edges) {
    if (edgeIds.has(e.id)) issues.push({ severity: "error", edgeId: e.id, message: `Duplicate edge id ${e.id}` });
    edgeIds.add(e.id);
    if (e.latencyMs !== undefined && !(Number.isFinite(e.latencyMs) && e.latencyMs >= 0)) issues.push({ severity: "error", edgeId: e.id, message: "Edge latency must be ≥ 0" });
    if (e.maxRps !== undefined && !(Number.isFinite(e.maxRps) && e.maxRps >= 0)) issues.push({ severity: "error", edgeId: e.id, message: "Edge bandwidth cap must be ≥ 0" });
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) { issues.push({ severity: "error", edgeId: e.id, message: "Edge points at a missing node" }); continue; }
    if (a.id === b.id) { issues.push({ severity: "error", edgeId: e.id, message: "A node cannot connect to itself" }); continue; }
    const c = checkConnection(reg, a.kind, e.fromPort, b.kind, e.toPort);
    if (!c.ok) issues.push({ severity: "error", edgeId: e.id, message: c.reason });
    else if (!reg.get(a.kind)?.ports.find((p) => p.id === e.fromPort)?.protocols.includes(e.protocol) || !reg.get(b.kind)?.ports.find((p) => p.id === e.toPort)?.protocols.includes(e.protocol))
      issues.push({ severity: "error", edgeId: e.id, message: `Protocol ${e.protocol} is not supported by both ${a.kind}.${e.fromPort} and ${b.kind}.${e.toPort}` });
  }

  for (const n of doc.nodes) {
    const def = reg.get(n.kind);
    if (!def?.validate) continue;
    const view: GraphView = {
      nodeId: n.id,
      incoming: doc.edges.filter((e) => e.to === n.id).map((e) => ({ fromKind: byId.get(e.from)?.kind ?? "", port: e.toPort, edgeId: e.id })),
      outgoing: doc.edges.filter((e) => e.from === n.id).map((e) => ({ toKind: byId.get(e.to)?.kind ?? "", port: e.fromPort, edgeId: e.id })),
    };
    for (const i of def.validate({ ...def.defaults, ...n.config }, view)) issues.push({ ...i, nodeId: n.id });
  }
  return issues;
}
