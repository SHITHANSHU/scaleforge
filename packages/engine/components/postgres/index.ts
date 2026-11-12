import { defineComponent } from "../../core/define";
import { clamp, mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";
import { postgresPresets } from "./presets";

interface Config {
  maxConnections: number; readQps: number; writeQps: number; readReplicas: number; indexes: number; queryMs: number; replicaLagBaseMs: number;
  [k: string]: number;
}
interface State { depth: number; util: number; conns: number; lagMs: number; saturatedAt: number }

export default defineComponent<Config, State>({
  kind: "postgres",
  version: "1.0.0",
  name: "PostgreSQL",
  description: "Relational database with connection limits, read/write capacity, replicas and replica lag.",
  category: "data",
  icon: "database",
  ports: [
    { id: "in", direction: "in", label: "Queries", protocols: ["database", "tcp"] },
    { id: "result", direction: "out", label: "Results", protocols: ["database"], hidden: true },
    { id: "cdc", direction: "out", label: "WAL / CDC", protocols: ["cdc"] },
  ],
  defaults: { maxConnections: 100, readQps: 4000, writeQps: 1200, readReplicas: 0, indexes: 3, queryMs: 4, replicaLagBaseMs: 20 },
  fields: [
    { key: "maxConnections", label: "Max connections", type: "number", min: 5, max: 5000, step: 5, group: "Limits" },
    { key: "readQps", label: "Read capacity (primary)", type: "number", min: 100, max: 500000, step: 100, unit: "qps", scale: "log", group: "Capacity" },
    { key: "writeQps", label: "Write capacity (primary)", type: "number", min: 50, max: 200000, step: 50, unit: "qps", scale: "log", group: "Capacity" },
    { key: "readReplicas", label: "Read replicas", type: "number", min: 0, max: 15, step: 1, group: "Scaling", help: "Each replica adds read capacity but serves slightly stale data." },
    { key: "indexes", label: "Indexes per table", type: "number", min: 0, max: 20, step: 1, group: "Schema", help: "Each index speeds reads but amplifies writes." },
    { key: "queryMs", label: "Typical query time", type: "number", min: 0.1, max: 1000, step: 0.1, unit: "ms", scale: "log", group: "Capacity" },
    { key: "replicaLagBaseMs", label: "Baseline replica lag", type: "number", min: 0, max: 5000, step: 5, unit: "ms", group: "Scaling" },
  ],
  presets: postgresPresets,
  derived(c) {
    const w = c.writeQps / (1 + 0.1 * c.indexes);
    return [
      { label: "Effective write capacity", value: `${Math.round(w).toLocaleString()} qps`, help: `Index write amplification ≈ ×${(1 + 0.1 * c.indexes).toFixed(1)} (approximation).`, tone: c.indexes > 8 ? "warn" : "ok" },
      { label: "Total read capacity", value: `${(c.readQps * (1 + c.readReplicas)).toLocaleString()} qps` },
    ];
  },
  metrics: [
    { id: "utilization", label: "Utilization", unit: "%" },
    { id: "connections", label: "Connections in use", unit: "" },
    { id: "replicaLagMs", label: "Replica lag", unit: "ms" },
      ],
  docs: {
    summary: "Primary plus optional read replicas. Writes go to the primary; reads spread over primary and replicas.",
    models: ["Separate read and write capacity", "Index write amplification", "Connection exhaustion via Little's law", "Replica lag grows with write utilization"],
    simplifies: ["No lock contention or query planning; capacity is a flat qps figure", "Replicas are identical and share reads evenly", "Replica lag is an approximation from write saturation", "MySQL differences are not modeled"],
    failureScenarios: ["Connection exhaustion rejects queries", "Write amplification from too many indexes", "Read-after-write staleness on replicas"],
    references: [{ title: "PostgreSQL high availability, load balancing and replication", url: "https://www.postgresql.org/docs/current/high-availability.html" }],
  },
  init: (c) => ({ depth: 0, util: 0, conns: 0, lagMs: c.replicaLagBaseMs, saturatedAt: -1 }),
  validate: (c, v) => v.incoming.length === 0 ? [{ severity: "info", message: "Nothing queries this database yet" }] : c.readReplicas > 0 ? [{ severity: "info", message: "Reads on replicas may be stale (read-after-write)" }] : [],
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const reads = m.count * m.readFraction, writes = m.count - reads;
    const readCap = c.readQps * (1 + c.readReplicas), writeCap = c.writeQps / (1 + 0.1 * c.indexes);
    // time-share: a unit of capacity-seconds is consumed by reads/writes in proportion to their cost
    const demand = reads / readCap + writes / writeCap;
    const capSeconds = ctx.dt; // demand beyond one second of capacity per second is shed
    const scale = demand > capSeconds ? capSeconds / demand : 1;
    const overflow = m.count * (1 - scale);
    const rate = (m.count * scale) / ctx.dt;
    const conns = rate * (c.queryMs / 1000);
    const rejected = conns > c.maxConnections ? m.count * scale * (1 - c.maxConnections / conns) : 0;
    const served = m.count * scale - rejected;
    const util = clamp(demand / capSeconds, 0, 1);
    const lagMs = c.replicaLagBaseMs * (1 + 20 * Math.pow(util, 4));
    if (rejected > 0 && s.saturatedAt < 0) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "connections-exhausted", message: "Connection limit reached — queries rejected" });
    const lat = m.latencyMs + c.queryMs / Math.max(0.05, 1 - util * 0.95);
    return {
      state: { depth: 0, util, conns, lagMs, saturatedAt: rejected > 0 ? ctx.time : -1 },
      outbound: [
        { port: "result", count: served, latencyMs: lat, readFraction: m.readFraction },
        // every committed write lands in the WAL; only emitted when something (e.g. Debezium) is attached
        ...((ctx.outEdges.cdc?.length ?? 0) > 0 ? [{ port: "cdc", count: served * (1 - m.readFraction), latencyMs: 0, readFraction: 0 }] : []),
      ],
      dropped: overflow + rejected, events,
    };
  },
  sample: (_c, s) => ({ utilization: s.util, connections: s.conns, replicaLagMs: s.lagMs, queueDepth: s.depth }),
});
