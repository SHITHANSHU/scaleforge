import { createRng } from "./rng";
import { validateConfig } from "./registry";
import type { ComponentDefinition, ConfigRecord, TickContext } from "./types";

/**
 * Every component must pass this. Returns human-readable problems; empty = compliant.
 * Run it from your component's test: `expect(checkComponentContract(def, protocolIds)).toEqual([])`.
 */
export function checkComponentContract(def: ComponentDefinition<any, any>, knownProtocols: string[]): string[] {
  const p: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(def.kind)) p.push(`kind "${def.kind}" must be kebab-case`);
  if (!/^\d+\.\d+\.\d+$/.test(def.version)) p.push("version must be semver");
  for (const k of ["name", "description", "icon"] as const) if (!def[k]) p.push(`${k} is required`);
  if (def.ports.length === 0) p.push("declare at least one port");
  const ids = new Set<string>();
  for (const port of def.ports) {
    if (ids.has(port.id)) p.push(`duplicate port ${port.id}`);
    ids.add(port.id);
    if (port.protocols.length === 0) p.push(`port ${port.id} needs protocols`);
    for (const pr of port.protocols) if (!knownProtocols.includes(pr)) p.push(`port ${port.id}: unknown protocol ${pr}`);
  }
  for (const i of validateConfig(def.fields, def.defaults)) p.push(`defaults: ${i.message}`);
  const fieldKeys = new Set(def.fields.map((f) => f.key));
  for (const k of Object.keys(def.defaults)) if (!fieldKeys.has(k)) p.push(`default "${k}" has no field metadata`);
  for (const pr of def.presets) {
    for (const [k, v] of Object.entries(pr.values)) {
      if (!fieldKeys.has(k)) p.push(`preset ${pr.id}: unknown key ${k}`);
      else if (validateConfig(def.fields, { ...def.defaults, [k]: v } as ConfigRecord).some((i) => i.field === k)) p.push(`preset ${pr.id}: ${k} out of range`);
    }
    if (!pr.approximate && !pr.source) p.push(`preset ${pr.id}: exact values need a source`);
  }
  const d = def.docs;
  if (!d.summary || d.models.length === 0 || d.simplifies.length === 0 || d.failureScenarios.length === 0 || d.references.length === 0) p.push("docs must fill summary, models, simplifies, failureScenarios, references");

  // Behavioral: a tick on an idle node must be finite, deterministic and report declared metrics.
  const mk = (): TickContext => ({
    dt: 0.01, time: 0, rps: 0, regionRttMs: 0, rng: createRng(1), nodeId: "n", outEdges: {}, isEdgeTargetDown: () => false, feedback: () => ({ sent: 0, failed: 0, timedOut: 0 }), faults: [],
  });
  const run = () => {
    const s = def.init(def.defaults);
    const inbound = def.ports.filter((x) => x.direction === "in").map((x) => ({ port: x.id, edgeId: "e", protocol: x.protocols[0]!, count: 10, latencyMs: 1, readFraction: 0.8 }));
    const r = def.tick(mk(), def.defaults, s, inbound);
    return { r, m: def.sample(def.defaults, r.state) };
  };
  try {
    const a = run(), b = run();
    if (JSON.stringify(a) !== JSON.stringify(b)) p.push("tick is not deterministic for equal seed/state");
    const nums = [a.r.dropped, ...a.r.outbound.flatMap((o) => [o.count, o.latencyMs]), ...Object.values(a.m)];
    if (nums.some((n) => !Number.isFinite(n))) p.push("tick/sample produced NaN or Infinity");
    const metricIds = new Set(def.metrics.map((m) => m.id));
    for (const k of metricIds) if (!(k in a.m)) p.push(`declared metric "${k}" missing from sample()`);
    for (const o of a.r.outbound) if (!def.ports.some((x) => x.id === o.port && x.direction === "out")) p.push(`tick emitted on undeclared out port "${o.port}"`);
  } catch (e) { p.push(`tick threw: ${(e as Error).message}`); }
  return p;
}
