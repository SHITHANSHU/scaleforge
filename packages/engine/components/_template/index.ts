// Copy this folder to components/<your-kind>/, rename, then register it in components/index.ts.
import { defineComponent } from "../../core/define";
import { mergeInflows, stepQueue } from "../../core/flow";

interface Config { ratePerSec: number; baseLatencyMs: number; queueLimit: number; [k: string]: number }
interface State { depth: number; util: number }

export default defineComponent<Config, State>({
  kind: "template",
  version: "0.1.0",
  name: "Template component",
  description: "A bounded queue served at a fixed rate. Replace with your model.",
  category: "compute",
  icon: "box",
  // Ports decide what can connect. Most specific protocol first.
  ports: [
    { id: "in", direction: "in", label: "In", protocols: ["http"] },
    { id: "out", direction: "out", label: "Out", protocols: ["http"] },
  ],
  defaults: { ratePerSec: 1000, baseLatencyMs: 5, queueLimit: 200 },
  // The inspector renders these. Every default key needs a field.
  fields: [
    { key: "ratePerSec", label: "Throughput", type: "number", min: 1, max: 1e6, step: 1, unit: "req/s", scale: "log", help: "Why this matters, in one sentence." },
    { key: "baseLatencyMs", label: "Service time", type: "number", min: 0, max: 5000, step: 1, unit: "ms" },
    { key: "queueLimit", label: "Queue limit", type: "number", min: 0, max: 1e6, step: 10 },
  ],
  presets: [],
  metrics: [{ id: "utilization", label: "Utilization", unit: "%" }, { id: "queueDepth", label: "Queue depth", unit: "req" }],
  docs: {
    summary: "What this represents.",
    models: ["What the simulator models"],
    simplifies: ["What it intentionally leaves out"],
    failureScenarios: ["How it fails"],
    references: [{ title: "Real-world reference" }],
  },
  init: () => ({ depth: 0, util: 0 }),
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const q = stepQueue(s.depth, m.count, c.ratePerSec * ctx.dt, c.queueLimit, ctx.dt);
    return {
      state: { depth: q.depth, util: q.processed / (c.ratePerSec * ctx.dt) },
      outbound: [{ port: "out", count: q.processed, latencyMs: m.latencyMs + c.baseLatencyMs + q.waitMs, readFraction: m.readFraction }],
      dropped: q.dropped,
      events: [],
    };
  },
  sample: (_c, s) => ({ utilization: s.util, queueDepth: s.depth }),
});
