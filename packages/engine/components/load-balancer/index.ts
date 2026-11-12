import { defineComponent } from "../../core/define";
import { clamp, stepQueue } from "../../core/flow";
import { mergeInflows } from "../../core/flow";
import type { Outflow } from "../../core/types";
import { ringShares } from "../../algorithms/consistent-hash";

interface Config {
  algorithm: string; maxRps: number; healthChecks: boolean; checkIntervalSec: number; unhealthyThreshold: number; addedLatencyMs: number; dnsTtlSec: number; staleClientPct: number; costPerHour: number;
  [k: string]: number | string | boolean;
}
interface State { depth: number; util: number; downFor: Record<string, number>; weights: Record<string, number> }

export default defineComponent<Config, State>({
  kind: "load-balancer",
  version: "1.0.0",
  name: "Load balancer",
  description: "Spreads traffic across backends and fails over when health checks notice a dead target.",
  category: "network",
  icon: "split",
  ports: [
    { id: "in", direction: "in", label: "Ingress", protocols: ["http", "grpc", "tcp", "websocket"] },
    { id: "out", direction: "out", label: "Backends", protocols: ["http", "grpc", "tcp", "websocket"] },
  ],
  defaults: { algorithm: "round-robin", maxRps: 50000, healthChecks: true, checkIntervalSec: 5, unhealthyThreshold: 2, addedLatencyMs: 1, dnsTtlSec: 0, staleClientPct: 0, costPerHour: 0.05 },
  fields: [
    { key: "costPerHour", label: "Price", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "algorithm", label: "Algorithm", type: "select", group: "Routing", options: [
      { value: "round-robin", label: "Round robin", hint: "Even split" },
      { value: "least-conn", label: "Least connections", hint: "Shifts away from slow targets" },
      { value: "consistent-hash", label: "Consistent hash", hint: "Sticky; uneven under skew" },
      { value: "failover", label: "Active-passive failover", hint: "All traffic to the first healthy backend (edge order = priority)" },
    ] },
    { key: "maxRps", label: "Throughput limit", type: "number", min: 100, max: 1000000, step: 100, unit: "req/s", scale: "log", group: "Capacity" },
    { key: "addedLatencyMs", label: "Added latency", type: "number", min: 0, max: 50, step: 0.5, unit: "ms", group: "Capacity" },
    { key: "healthChecks", label: "Health checks", type: "switch", group: "Failover" },
    { key: "checkIntervalSec", label: "Check interval", type: "number", min: 1, max: 60, step: 1, unit: "s", group: "Failover", showIf: { key: "healthChecks", equals: true } },
    { key: "dnsTtlSec", label: "Client cache TTL (DNS)", type: "number", min: 0, max: 3600, step: 5, unit: "s", group: "Failover", showIf: { key: "healthChecks", equals: true }, help: "Clients that resolved the old answer keep using it until their cache expires. 0 = instant (L4/L7 balancer in the path)." },
    { key: "staleClientPct", label: "Clients that ignore updates", type: "number", min: 0, max: 100, step: 1, unit: "%", group: "Failover", showIf: { key: "healthChecks", equals: true }, help: "Some clients never re-resolve; they keep hitting the dead backend." },
    { key: "unhealthyThreshold", label: "Unhealthy threshold", type: "number", min: 1, max: 10, step: 1, unit: "checks", group: "Failover", showIf: { key: "healthChecks", equals: true }, help: "Consecutive failed checks before a target is removed." },
  ],
  costPerHour: (c) => c.costPerHour,
  presets: [],
  derived: (c) => c.healthChecks
    ? [{ label: "Failure detection time", value: `${c.checkIntervalSec * c.unhealthyThreshold} s`, help: "Traffic sent to a dead target is lost until detection.", tone: c.checkIntervalSec * c.unhealthyThreshold > 15 ? "warn" : "ok" }]
    : [{ label: "Failure detection", value: "never", tone: "bad", help: "Without health checks a dead target keeps receiving traffic." }],
  metrics: [
    { id: "utilization", label: "Utilization", unit: "%" },
    { id: "queueDepth", label: "Queue depth", unit: "req" },
  ],
  docs: {
    summary: "L4/L7 load balancer distributing flow across its outgoing edges.",
    models: ["Throughput ceiling with bounded queue", "Health-check detection delay before failover", "Uneven split for consistent hashing"],
    simplifies: ["No connection-level state or session stickiness beyond a fixed per-target weight", "Least-conn approximated as an even split among healthy targets"],
    failureScenarios: ["Backend dies: traffic is lost until health checks notice", "Consistent hash hotspot on one target"],
    references: [{ title: "Load balancing algorithms (NGINX docs)", url: "https://nginx.org/en/docs/http/load_balancing.html" }],
  },
  init: () => ({ depth: 0, util: 0, downFor: {}, weights: {} }),
  validate: (_c, v) => (v.outgoing.length === 0 ? [{ severity: "warn", message: "No backends connected" }] : []),
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const q = stepQueue(s.depth, m.count, c.maxRps * ctx.dt, c.maxRps * ctx.dt * 0.5, ctx.dt);
    const edges = ctx.outEdges.out ?? [];
    const downFor = { ...s.downFor };
    const weights = { ...s.weights };
    const detectDelay = c.healthChecks ? c.checkIntervalSec * c.unhealthyThreshold : Infinity;
    const detected: Record<string, boolean> = {};
    for (const id of edges) {
      downFor[id] = ctx.isEdgeTargetDown(id) ? (downFor[id] ?? 0) + ctx.dt : 0;
      detected[id] = c.healthChecks && downFor[id]! >= detectDelay;
    }
    // real hash ring with few virtual nodes: shares are uneven, as in practice
    if (c.algorithm === "consistent-hash" && edges.some((id) => weights[id] === undefined)) {
      const shares = ringShares(edges, 12);
      for (const id of edges) weights[id] = (shares[id] ?? 0) * edges.length;
    }
    const primary = edges.find((id) => !detected[id]); // failover: first backend not yet known to be dead
    const base = (id: string) => (c.algorithm === "consistent-hash" ? weights[id] ?? 1 : c.algorithm === "failover" ? (id === primary ? 1 : 0) : 1);
    // a dead backend keeps a share of traffic until failure is detected, then only the clients with cached/ignored answers
    const stale = (id: string) => {
      if (!detected[id]) return 1;
      const since = downFor[id]! - detectDelay;
      const ramp = c.dnsTtlSec > 0 ? clamp(1 - since / c.dnsTtlSec, 0, 1) : 0;
      return Math.max(ramp, c.staleClientPct / 100);
    };
    const w: Record<string, number> = {};
    let sumW = 0;
    if (c.algorithm === "failover") {
      // clients still pinned to a dead backend vs those that moved on to the standby
      let pinned = 0;
      for (const id of edges) if (detected[id]) { w[id] = stale(id); pinned += w[id]!; }
      for (const id of edges) if (!detected[id]) w[id] = id === primary ? Math.max(0, 1 - pinned) : 0;
      for (const id of edges) sumW += w[id]!;
    } else for (const id of edges) { w[id] = detected[id] ? base(id) * stale(id) : base(id); sumW += w[id]!; }
    if (sumW <= 0) for (const id of edges) { w[id] = detected[id] ? 0 : 1; sumW += w[id]!; } // failover with everything dead
    const alive = edges.filter((id) => (w[id] ?? 0) > 0);
    const outbound: Outflow[] = alive.map((id) => ({
      port: "out", edgeId: id, count: (q.processed * (w[id] ?? 0)) / (sumW || 1),
      latencyMs: m.latencyMs + c.addedLatencyMs + q.waitMs, readFraction: m.readFraction,
    }));
    // nothing connected: let flow leave the system rather than vanish
    if (edges.length === 0) outbound.push({ port: "out", count: q.processed, latencyMs: m.latencyMs + c.addedLatencyMs + q.waitMs, readFraction: m.readFraction });
    return { state: { depth: q.depth, util: q.processed / (c.maxRps * ctx.dt), downFor, weights }, outbound, dropped: q.dropped + (edges.length > 0 && alive.length === 0 ? q.processed : 0), events: [] };
  },
  sample: (_c, s) => ({ utilization: s.util, queueDepth: s.depth }),
});
