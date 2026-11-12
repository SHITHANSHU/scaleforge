import { z } from "zod";
import { defaultScenario, SCHEMA_VERSION, type Design } from "../state/types";

// ---- Validation + migrations ----
const config = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));
const nodeSchema = z.object({ id: z.string(), kind: z.string(), label: z.string().optional(), config, x: z.number(), y: z.number(), w: z.number().optional(), h: z.number().optional(), parentId: z.string().optional() });
const edgeSchema = z.object({ id: z.string(), from: z.string(), fromPort: z.string(), to: z.string(), toPort: z.string(), protocol: z.string(), latencyMs: z.number().optional(), maxRps: z.number().optional() });
const faultSchema = z.object({ id: z.string(), kind: z.string(), target: z.string(), atSec: z.number(), untilSec: z.number().optional(), params: config.optional() });
const traffic = z.discriminatedUnion("type", [
  z.object({ type: z.literal("constant"), rps: z.number() }),
  z.object({ type: z.literal("ramp"), fromRps: z.number(), toRps: z.number() }),
  z.object({ type: z.literal("step"), baseRps: z.number(), stepRps: z.number(), atSec: z.number() }),
  z.object({ type: z.literal("spike"), baseRps: z.number(), spikeRps: z.number(), atSec: z.number(), widthSec: z.number() }),
  z.object({ type: z.literal("pulses"), baseRps: z.number(), peakRps: z.number(), firstAtSec: z.number(), widthSec: z.number(), everySec: z.number(), count: z.number() }),
]);
const scenarioSchema = z.object({ name: z.string(), durationSec: z.number(), tickMs: z.number().optional(), seed: z.number(), traffic, faults: z.array(faultSchema) });
export const designSchema = z.object({
  schemaVersion: z.number(), id: z.string(), name: z.string(), nodes: z.array(nodeSchema), edges: z.array(edgeSchema), scenario: scenarioSchema, updatedAt: z.number(),
});

/** Old versions run through these in order. Add one per schema bump; golden fixtures live in tests. */
const migrations: Record<number, (d: any) => any> = {
  // 0 → 1: pre-release files had no scenario and no schemaVersion
  0: (d) => ({ ...d, schemaVersion: 1, scenario: d.scenario ?? defaultScenario(), updatedAt: d.updatedAt ?? Date.now(), id: d.id ?? `d_${Date.now().toString(36)}` }),
};

export function migrate(raw: unknown): Design {
  let d: any = raw;
  if (typeof d !== "object" || d === null) throw new Error("Not a ScaleForge design");
  let v = typeof d.schemaVersion === "number" ? d.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new Error(`Design is from a newer version (schema ${v}); update ScaleForge.`);
  while (v < SCHEMA_VERSION) { d = migrations[v]!(d); v = d.schemaVersion; }
  return designSchema.parse(d) as Design;
}

