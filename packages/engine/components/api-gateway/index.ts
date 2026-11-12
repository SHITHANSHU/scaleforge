import { defineComponent } from "../../core/define";
import { clamp, mergeInflows, stepQueue } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config {
  capacityRps: number; shedding: boolean; maxQueueAgeMs: number; queueLimit: number; addedLatencyMs: number;
  breaker: boolean; tripErrorPct: number; minSamplesRps: number; openSec: number; probePct: number; costPerHour: number;
  [k: string]: number | boolean;
}
interface State { depth: number; mode: "closed" | "open" | "half"; since: number; failEwma: number; util: number; shed: number; trips: number; modeCode: number; passed: number; probeSent: number; probeFailed: number }

export default defineComponent<Config, State>({
  kind: "api-gateway",
  version: "1.0.0",
  name: "API gateway",
  description: "Front door that protects what's behind it: load shedding, a circuit breaker and a bounded queue.",
  category: "network",
  icon: "shield",
  ports: [
    { id: "in", direction: "in", label: "Ingress", protocols: ["http", "grpc", "database", "cache-access", "tcp"] },
    { id: "out", direction: "out", label: "Upstreams", protocols: ["http", "grpc", "database", "cache-access"] },
  ],
  defaults: { capacityRps: 20000, shedding: true, maxQueueAgeMs: 200, queueLimit: 200000, addedLatencyMs: 1, breaker: true, tripErrorPct: 50, minSamplesRps: 20, openSec: 10, probePct: 5, costPerHour: 0.1 },
  fields: [
    { key: "capacityRps", label: "Gateway throughput", type: "number", min: 100, max: 1e6, step: 100, unit: "req/s", scale: "log", group: "Capacity" },
    { key: "addedLatencyMs", label: "Added latency", type: "number", min: 0, max: 100, step: 0.5, unit: "ms", group: "Capacity" },
    { key: "costPerHour", label: "Price", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "shedding", label: "Shed load by queue age", type: "switch", group: "Load shedding", help: "Reject requests that would wait longer than the max age. Without it the queue grows and every request becomes slow." },
    { key: "maxQueueAgeMs", label: "Max queue age", type: "number", min: 5, max: 10000, step: 5, unit: "ms", scale: "log", group: "Load shedding", showIf: { key: "shedding", equals: true } },
    { key: "queueLimit", label: "Queue limit (if not shedding)", type: "number", min: 100, max: 1e7, step: 100, scale: "log", group: "Load shedding", showIf: { key: "shedding", equals: false } },
    { key: "breaker", label: "Circuit breaker", type: "switch", group: "Circuit breaker", help: "Stop sending to an upstream that is failing, so it can recover; probe it periodically." },
    { key: "tripErrorPct", label: "Trip at error rate", type: "number", min: 1, max: 100, step: 1, unit: "%", group: "Circuit breaker", showIf: { key: "breaker", equals: true } },
    { key: "minSamplesRps", label: "Minimum traffic to judge", type: "number", min: 1, max: 10000, step: 1, unit: "req/s", group: "Circuit breaker", showIf: { key: "breaker", equals: true } },
    { key: "openSec", label: "Open duration", type: "number", min: 1, max: 300, step: 1, unit: "s", group: "Circuit breaker", showIf: { key: "breaker", equals: true }, help: "How long to fail fast before probing." },
    { key: "probePct", label: "Probe share when half-open", type: "number", min: 1, max: 50, step: 1, unit: "%", group: "Circuit breaker", showIf: { key: "breaker", equals: true } },
  ],
  presets: [],
  costPerHour: (c) => c.costPerHour,
  derived: (c) => [
    { label: "Max queue wait", value: c.shedding ? `${c.maxQueueAgeMs} ms` : `${Math.round((c.queueLimit / c.capacityRps) * 1000)} ms`, tone: !c.shedding && c.queueLimit / c.capacityRps > 1 ? "bad" : "ok", help: c.shedding ? "Requests older than this are rejected, keeping the rest fast." : "A deep queue means requests wait long and often time out before being served." },
    ...(c.breaker ? [{ label: "Fail-fast window after a trip", value: `${c.openSec} s` }] : []),
  ],
  metrics: [
    { id: "utilization", label: "Utilization", unit: "%" },
    { id: "breakerState", label: "Breaker (0 closed, 1 open, 2 half-open)", unit: "" },
    { id: "shedRate", label: "Shed", unit: "req/s" },
    { id: "trips", label: "Breaker trips", unit: "" },
    { id: "queueDepth", label: "Queue depth", unit: "req" },
  ],
  docs: {
    summary: "Protects a dependency and its callers from overload and from each other's failures.",
    models: ["Bounded throughput with a queue", "Load shedding by queue age (reject instead of serving stale requests)", "Circuit breaker: closed → open → half-open with probes, tripping on the failure rate reported by upstreams", "Fail-fast rejections reported to callers as errors"],
    simplifies: ["No per-route or per-client limits, priorities or criticality tiers", "Failure rate is smoothed over a fixed ~5 s window", "No fallback responses: an open breaker rejects", "Trip thresholds are free parameters, not recommended values"],
    failureScenarios: ["No shedding: deep queue turns overload into universal timeouts", "Breaker too sensitive: flaps and starves a healthy upstream", "Breaker with nothing behind it: callers just see errors faster"],
    references: [
      { title: "AWS Builders' Library: Using load shedding to avoid overload", url: "https://builder.aws.com/content/3Eun1EEyX6p2e3VYNyRLSJzLuMV/using-load-shedding-to-avoid-overload" },
      { title: "Google SRE book: Handling overload", url: "https://sre.google/sre-book/handling-overload/" },
      { title: "Google SRE book: Addressing cascading failures", url: "https://sre.google/sre-book/addressing-cascading-failures/" },
    ],
  },
  init: () => ({ depth: 0, mode: "closed", since: 0, failEwma: 0, util: 0, shed: 0, trips: 0, modeCode: 0, passed: 0, probeSent: 0, probeFailed: 0 }),
  validate: (c, v) => [
    ...(v.outgoing.length === 0 ? [{ severity: "warn" as const, message: "Nothing behind the gateway" }] : []),
    ...(!c.shedding && c.queueLimit / c.capacityRps > 2 ? [{ severity: "warn" as const, field: "queueLimit", message: "Deep queue without shedding: expect long waits and timeouts under overload" }] : []),
  ],
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    let { mode, since, failEwma, trips, probeSent, probeFailed } = s;

    // read downstream health
    let sent = 0, failed = 0;
    for (const es of Object.values(ctx.outEdges)) for (const id of es) { const f = ctx.feedback(id); sent += f.sent; failed += f.failed; }
    if (sent / ctx.dt >= c.minSamplesRps) failEwma += ((failed / sent) - failEwma) * (1 - Math.exp(-ctx.dt / 3));
    else failEwma *= 1 - ctx.dt / 10;

    if (c.breaker) {
      if (mode === "closed" && failEwma * 100 >= c.tripErrorPct) { mode = "open"; since = ctx.time; trips++; events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "breaker-open", message: `Circuit breaker opened (${(failEwma * 100).toFixed(0)}% failures) — failing fast` }); }
      else if (mode === "open" && ctx.time - since >= c.openSec) { mode = "half"; since = ctx.time; failEwma = 0; probeSent = 0; probeFailed = 0; events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "info", kind: "breaker-half-open", message: "Circuit breaker half-open — probing" }); }
      else if (mode === "half") {
        probeSent += sent; probeFailed += failed;
        // decide only on real evidence: enough probes seen, or the probe window ran out
        if (probeSent >= 20 || ctx.time - since >= 30) {
          if (probeSent < 20 || probeFailed / probeSent >= c.tripErrorPct / 100) { mode = "open"; since = ctx.time; events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "breaker-reopen", message: probeSent < 20 ? "No probe evidence — breaker re-opened" : "Probes failed — breaker re-opened" }); }
          else { mode = "closed"; failEwma = 0; events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "info", kind: "breaker-closed", message: "Probes succeeded — breaker closed" }); }
        }
      }
    } else mode = "closed";

    // breaker decides how much may pass upstream
    const allow = mode === "closed" ? 1 : mode === "half" ? c.probePct / 100 : 0;
    const limit = c.shedding ? (c.capacityRps * c.maxQueueAgeMs) / 1000 : c.queueLimit;
    const q = stepQueue(s.depth, m.count, c.capacityRps * ctx.dt, limit, ctx.dt);
    const toUp = q.processed * allow;
    const rejectedByBreaker = q.processed - toUp;
    const shed = q.dropped;
    const lat = m.latencyMs + c.addedLatencyMs + q.waitMs;
    return {
      state: { depth: q.depth, mode, since, failEwma, util: q.processed / (c.capacityRps * ctx.dt), shed: shed / ctx.dt, trips, modeCode: mode === "closed" ? 0 : mode === "open" ? 1 : 2, passed: toUp, probeSent, probeFailed },
      outbound: [{ port: "out", count: toUp, latencyMs: lat, readFraction: m.readFraction }],
      dropped: shed + rejectedByBreaker, events,
    };
  },
  sample: (_c, s) => ({ utilization: clamp(s.util, 0, 1), breakerState: s.modeCode, shedRate: s.shed, trips: s.trips, queueDepth: s.depth }),
});
