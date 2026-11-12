import { defineComponent } from "../../core/define";
import { mergeInflows, stepQueue } from "../../core/flow";

interface Config { windowSec: number; dupDelaySec: number; capacityRps: number; lookupMs: number; failOpen: boolean; costPerHour: number; [k: string]: number | boolean }
interface State { depth: number; util: number; caught: number; leaked: number; down: boolean }

export default defineComponent<Config, State>({
  kind: "idempotency-store",
  version: "1.0.0",
  name: "Idempotency / dedup store",
  description: "Remembers recent request keys so retried or redelivered work is answered from memory instead of being executed twice.",
  category: "data",
  icon: "layers",
  ports: [
    { id: "in", direction: "in", label: "Requests", protocols: ["http", "grpc", "message-queue", "event-stream"] },
    { id: "out", direction: "out", label: "First executions", protocols: ["http", "grpc", "database", "message-queue", "event-stream"] },
    { id: "replay", direction: "out", label: "Stored results", protocols: ["http"], hidden: true },
  ],
  defaults: { windowSec: 300, dupDelaySec: 20, capacityRps: 20000, lookupMs: 1, failOpen: true, costPerHour: 0.1 },
  fields: [
    { key: "windowSec", label: "Key retention (dedup window)", type: "number", min: 1, max: 604800, step: 1, unit: "s", scale: "log", group: "Retention", help: "A duplicate arriving after the window looks like new work." },
    { key: "dupDelaySec", label: "Typical duplicate delay", type: "number", min: 0.1, max: 86400, step: 0.1, unit: "s", scale: "log", group: "Workload", help: "How long after the original a retry or redelivery tends to arrive. Heavy tails (redelivery after hours) need a longer window." },
    { key: "capacityRps", label: "Lookup throughput", type: "number", min: 100, max: 1e6, step: 100, unit: "req/s", scale: "log", group: "Capacity" },
    { key: "lookupMs", label: "Lookup latency", type: "number", min: 0.1, max: 100, step: 0.1, unit: "ms", group: "Capacity" },
    { key: "costPerHour", label: "Price", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "failOpen", label: "If the store is down: let requests through", type: "switch", group: "Failure", help: "Fail-open keeps availability but risks duplicates; fail-closed rejects everything." },
  ],
  costPerHour: (c) => c.costPerHour * Math.max(1, Math.log10(c.windowSec)), // longer retention stores more keys
  presets: [],
  faults: [{ kind: "store-down", label: "Store outage", description: "The key store is unavailable." }],
  derived: (c) => {
    const catchRate = 1 - Math.exp(-c.windowSec / c.dupDelaySec);
    return [{ label: "Duplicates caught", value: `${(catchRate * 100).toFixed(2)}%`, tone: catchRate < 0.99 ? "warn" : "ok", help: "Approximation: duplicates arrive with exponentially distributed delay." }];
  },
  metrics: [
    { id: "utilization", label: "Utilization", unit: "%" },
    { id: "caught", label: "Duplicates absorbed", unit: "req/s" },
    { id: "leaked", label: "Duplicates passed on", unit: "req/s" },
  ],
  docs: {
    summary: "Turns at-least-once delivery into effectively-once execution, up to the retention window.",
    models: ["Duplicates (from client retries after timeouts, broker redelivery) caught while keys are retained", "Duplicates after expiry pass through as new work", "Fail-open vs fail-closed when the store is unavailable", "Lookup capacity and latency"],
    simplifies: ["Duplicate arrival delay is modeled as exponential with a configured mean", "No in-progress markers for concurrent duplicates", "Exactly-once delivery is not claimed: this gives effectively-once execution at this boundary only", "Key storage size is not limited"],
    failureScenarios: ["Window shorter than the redelivery delay: duplicates slip through", "Store outage with fail-open: duplicate side effects", "Store outage with fail-closed: full outage"],
    references: [{ title: "Stripe: designing robust and predictable APIs with idempotency", url: "https://stripe.com/blog/idempotency" }, { title: "Confluent: exactly-once semantics in Apache Kafka", url: "https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/" }],
  },
  init: () => ({ depth: 0, util: 0, caught: 0, leaked: 0, down: false }),
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const down = ctx.faults.some((f) => f.kind === "store-down");
    if (down && !c.failOpen) return { state: { ...s, down, util: 0 }, outbound: [], dropped: m.count, events: s.down ? [] : [{ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "store-down", message: "Idempotency store down — failing closed" }] };
    const q = stepQueue(s.depth, m.count, c.capacityRps * ctx.dt, c.capacityRps * ctx.dt * 0.5, ctx.dt);
    const dupIn = q.processed * m.dupFraction;
    const catchRate = down ? 0 : 1 - Math.exp(-c.windowSec / c.dupDelaySec);
    const caught = dupIn * catchRate;
    const pass = q.processed - caught;
    const lat = m.latencyMs + c.lookupMs + q.waitMs;
    return {
      state: { depth: q.depth, util: q.processed / (c.capacityRps * ctx.dt), caught: caught / ctx.dt, leaked: (dupIn - caught) / ctx.dt, down },
      outbound: [
        { port: "out", count: pass, latencyMs: lat, readFraction: m.readFraction, dupFraction: pass > 0 ? (dupIn - caught) / pass : 0 },
        { port: "replay", count: caught, latencyMs: lat, readFraction: m.readFraction, dupFraction: 0 },
      ],
      dropped: q.dropped, events: down && !s.down ? [{ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "store-down", message: "Idempotency store down — failing open, duplicates may pass" }] : [],
    };
  },
  sample: (_c, s) => ({ utilization: s.util, caught: s.caught, leaked: s.leaked }),
});
