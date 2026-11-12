import { defineComponent } from "../../core/define";
import { mergeInflows } from "../../core/flow";
import { TokenBucket } from "../../algorithms/token-bucket";

interface Config { algorithm: string; limitRps: number; burst: number; nodes: number; driftPct: number; costPerHour: number; [k: string]: number | string }
interface State { bucket: TokenBucket; allowedRate: number; rejectedRate: number; windowAllowed: number[]; util: number }

export default defineComponent<Config, State>({
  kind: "rate-limiter",
  version: "1.0.0",
  name: "Rate limiter",
  description: "Token-bucket or sliding-window limiter that rejects traffic above a sustained rate.",
  category: "network",
  icon: "gauge",
  ports: [
    { id: "in", direction: "in", label: "Ingress", protocols: ["http", "grpc", "tcp", "websocket"] },
    { id: "out", direction: "out", label: "Allowed", protocols: ["http", "grpc", "tcp", "websocket"] },
  ],
  defaults: { algorithm: "token-bucket", limitRps: 1000, burst: 2000, nodes: 1, driftPct: 0, costPerHour: 0.03 },
  fields: [
    { key: "algorithm", label: "Algorithm", type: "select", group: "Limit", options: [
      { value: "token-bucket", label: "Token bucket", hint: "Allows bursts up to the bucket size" },
      { value: "sliding-window", label: "Sliding window", hint: "Hard cap per second, no bursts" },
    ] },
    { key: "limitRps", label: "Sustained limit", type: "number", min: 1, max: 1e6, step: 1, unit: "req/s", scale: "log", group: "Limit" },
    { key: "burst", label: "Bucket size", type: "number", min: 1, max: 1e6, step: 1, unit: "req", scale: "log", group: "Limit", showIf: { key: "algorithm", equals: "token-bucket" }, help: "Tokens available for a burst after quiet time." },
    { key: "costPerHour", label: "Price", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "nodes", label: "Limiter nodes", type: "number", min: 1, max: 50, step: 1, group: "Distribution", help: "Each node enforces its own local share." },
    { key: "driftPct", label: "Sync drift", type: "number", min: 0, max: 100, step: 1, unit: "%", group: "Distribution", help: "Distributed limiters lag in syncing counters, letting extra traffic through." },
  ],
  costPerHour: (c) => c.costPerHour * c.nodes,
  presets: [],
  derived: (c) => [
    { label: "Effective limit", value: `${Math.round(c.limitRps * (1 + (c.driftPct / 100) * (1 - 1 / c.nodes))).toLocaleString()} req/s`, tone: c.driftPct > 0 && c.nodes > 1 ? "warn" : "ok", help: c.nodes > 1 ? "Drift across nodes raises the real limit above the configured one." : undefined },
  ],
  metrics: [{ id: "utilization", label: "Limit used", unit: "%" }, { id: "rejected", label: "Rejected", unit: "req/s" }],
  docs: {
    summary: "Rejects requests above a rate. Real token bucket algorithm runs on the flow.",
    models: ["Token-bucket burst then sustained rate", "Sliding-window hard cap", "Distributed drift raising the effective limit"],
    simplifies: ["No per-key limits: one global bucket", "Rejections are counted as errors, not retried by clients"],
    failureScenarios: ["Burst exhausts tokens then sustained limit applies", "Distributed limiter over-admits when counters lag"],
    references: [{ title: "Stripe: scaling your API with rate limiters", url: "https://stripe.com/blog/rate-limiters" }],
  },
  init: (c) => ({ bucket: new TokenBucket(c.limitRps, c.burst), allowedRate: 0, rejectedRate: 0, windowAllowed: [], util: 0 }),
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const eff = c.limitRps * (1 + (c.driftPct / 100) * (1 - 1 / c.nodes));
    const bucket = c.algorithm === "token-bucket" ? new TokenBucket(eff, c.burst) : new TokenBucket(eff, eff * ctx.dt);
    bucket.tokens = c.algorithm === "token-bucket" ? Math.min(s.bucket.tokens, c.burst) : eff * ctx.dt;
    const ok = bucket.take(m.count, ctx.dt);
    return {
      state: { bucket, allowedRate: ok / ctx.dt, rejectedRate: (m.count - ok) / ctx.dt, windowAllowed: [], util: ok / ctx.dt / eff },
      outbound: [{ port: "out", count: ok, latencyMs: m.latencyMs + 0.2, readFraction: m.readFraction }],
      dropped: m.count - ok, events: [],
    };
  },
  sample: (_c, s) => ({ utilization: s.util, rejected: s.rejectedRate }),
});
