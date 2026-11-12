import { defineComponent } from "../../core/define";
import { clamp, mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config {
  nodes: number; maxConnsPerNode: number; memoryPerConnKB: number; memoryGiB: number; heartbeatSec: number; sessionSec: number;
  acceptPerSecPerNode: number; reconnectJitterSec: number; costPerNodeHour: number; [k: string]: number
}
interface State { conns: number; reconnecting: number; rejected: number; util: number; mem: number; storm: boolean }

export default defineComponent<Config, State>({
  kind: "websocket",
  sink: true,
  version: "1.0.0",
  name: "WebSocket gateway",
  description: "Long-lived connection capacity, heartbeat cost and reconnect storms after a deploy.",
  category: "network",
  icon: "network",
  ports: [
    { id: "in", direction: "in", label: "Connections", protocols: ["websocket", "http"] },
    { id: "out", direction: "out", label: "Auth / session calls", protocols: ["http", "grpc", "cache-access", "database"] },
  ],
  defaults: { nodes: 4, maxConnsPerNode: 50000, memoryPerConnKB: 20, memoryGiB: 4, heartbeatSec: 30, sessionSec: 600, acceptPerSecPerNode: 2000, reconnectJitterSec: 0, costPerNodeHour: 0.2 },
  fields: [
    { key: "nodes", label: "Gateway nodes", type: "number", min: 1, max: 200, step: 1, group: "Fleet" },
    { key: "maxConnsPerNode", label: "Max connections / node", type: "number", min: 100, max: 2e6, step: 100, scale: "log", group: "Capacity" },
    { key: "memoryPerConnKB", label: "Memory per connection", type: "number", min: 1, max: 1024, step: 1, unit: "KB", scale: "log", group: "Capacity" },
    { key: "memoryGiB", label: "Memory / node", type: "number", min: 0.5, max: 256, step: 0.5, unit: "GiB", scale: "log", group: "Capacity" },
    { key: "acceptPerSecPerNode", label: "Accept rate / node", type: "number", min: 10, max: 100000, step: 10, unit: "conn/s", scale: "log", group: "Capacity", help: "TLS handshakes limit how fast a node can take new connections." },
    { key: "costPerNodeHour", label: "Price per node", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "sessionSec", label: "Average session length", type: "number", min: 1, max: 86400, step: 1, unit: "s", scale: "log", group: "Behaviour" },
    { key: "heartbeatSec", label: "Heartbeat interval", type: "number", min: 1, max: 300, step: 1, unit: "s", group: "Behaviour", help: "Shorter heartbeats detect dead peers sooner but cost CPU." },
    { key: "reconnectJitterSec", label: "Reconnect jitter", type: "number", min: 0, max: 120, step: 1, unit: "s", group: "Behaviour", help: "Spread clients' reconnects after a drop. 0 = thundering herd." },
  ],
  presets: [],
  costPerHour: (c) => c.nodes * c.costPerNodeHour,
  faults: [{ kind: "deploy-restart", label: "Rolling deploy (drop all)", description: "Every connection drops at once; clients reconnect." }],
  derived(c) {
    const memCap = Math.floor((c.memoryGiB * 1024 * 1024 * 0.8) / c.memoryPerConnKB);
    const per = Math.min(c.maxConnsPerNode, memCap);
    return [
      { label: "Memory-bound connections / node", value: memCap.toLocaleString(), tone: memCap < c.maxConnsPerNode ? "warn" : "ok" },
      { label: "Fleet capacity", value: (per * c.nodes).toLocaleString() },
      { label: "Heartbeat load", value: `${Math.round((per * c.nodes) / c.heartbeatSec).toLocaleString()} msg/s at full` },
      { label: "Time to refill after a drop", value: `${Math.ceil((per * c.nodes) / (c.acceptPerSecPerNode * c.nodes))} s`, tone: "warn", help: "Bounded by accept rate, before any jitter." },
    ];
  },
  metrics: [
    { id: "utilization", label: "Connection capacity used", unit: "%" },
    { id: "connections", label: "Open connections", unit: "" },
    { id: "memory", label: "Memory", unit: "%" },
    { id: "reconnecting", label: "Waiting to reconnect", unit: "" },
    { id: "rejected", label: "Rejected / s", unit: "conn/s" },
  ],
  docs: {
    summary: "Connection-oriented gateway. Inbound flow = new connection attempts; open connections follow Little's law.",
    models: ["Connection capacity from node count, per-node limit and memory", "Accept-rate ceiling", "Heartbeat overhead", "Deploy drop and reconnect storm with optional jitter"],
    simplifies: ["Message fan-out cost is not modeled; only connection lifecycle", "Clients are indistinguishable; uneven spread across nodes is not modeled", "Reconnecting clients retry at the accept limit with no backoff"],
    failureScenarios: ["Reconnect storm after deploy overwhelms accept rate", "Memory exhaustion from per-connection buffers"],
    references: [{ title: "Phoenix Channels: 2 million connections", url: "https://www.phoenixframework.org/blog/the-road-to-2-million-websocket-connections" }],
  },
  init: () => ({ conns: 0, reconnecting: 0, rejected: 0, util: 0, mem: 0, storm: false }),
  validate: (c) => c.reconnectJitterSec === 0 ? [{ severity: "info", field: "reconnectJitterSec", message: "No reconnect jitter: a deploy will cause a thundering herd" }] : [],
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const memCap = Math.floor((c.memoryGiB * 1024 * 1024 * 0.8) / c.memoryPerConnKB);
    const cap = Math.min(c.maxConnsPerNode, memCap) * c.nodes;
    let conns = s.conns, reconnecting = s.reconnecting;
    if (ctx.faults.some((f) => f.kind === "deploy-restart" && f.justStarted)) {
      reconnecting += conns; conns = 0;
      events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "deploy", message: "Deploy dropped all connections — clients reconnecting" });
    }
    // reconnects are released over the jitter window (or all at once)
    const release = c.reconnectJitterSec > 0 ? Math.min(reconnecting, (reconnecting / Math.max(c.reconnectJitterSec, ctx.dt)) * ctx.dt * 2) : reconnecting;
    const attempts = m.count + release;
    const acceptCap = c.acceptPerSecPerNode * c.nodes * ctx.dt;
    const accepted = Math.min(attempts, acceptCap, Math.max(0, cap - conns));
    const rejected = attempts - accepted;
    // rejected reconnects retry; brand-new attempts are lost
    const retryShare = attempts > 0 ? release / attempts : 0;
    reconnecting = reconnecting - release + rejected * retryShare;
    conns = clamp(conns + accepted - (conns / c.sessionSec) * ctx.dt, 0, cap);
    const storm = reconnecting > cap * 0.2;
    if (storm && !s.storm) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "reconnect-storm", message: "Reconnect storm — accept rate saturated" });
    const mem = (conns / c.nodes) * c.memoryPerConnKB / (c.memoryGiB * 1024 * 1024);
    return {
      state: { conns, reconnecting, rejected: rejected / ctx.dt, util: cap > 0 ? conns / cap : 0, mem, storm },
      outbound: [{ port: "out", count: accepted, latencyMs: m.latencyMs + 5 + (attempts > acceptCap ? ((attempts - acceptCap) / acceptCap) * 1000 * ctx.dt * 50 : 0), readFraction: m.readFraction }],
      dropped: rejected * (1 - retryShare), events,
    };
  },
  sample: (_c, s) => ({ utilization: Math.max(s.util, s.storm ? 1 : 0), connections: s.conns, memory: s.mem, reconnecting: s.reconnecting, rejected: s.rejected }),
});
