import { defineComponent } from "../../core/define";
import { clamp, mergeInflows, stepQueue } from "../../core/flow";
import type { SimEvent } from "../../core/types";
import { redisPresets } from "./presets";

interface Config {
  memoryMB: number; evictionPolicy: string; ttlSec: number; keyspace: number; avgItemKB: number; zipfSkew: number;
  opsLimit: number; maxClients: number; baseLatencyMs: number; costPerGBHour: number; [k: string]: number | string;
}
interface State { filled: number; depth: number; hit: number; util: number; evictPerSec: number; memUtil: number; clients: number }

/** Share of reads that land in the hottest `c` of `n` keys under Zipf(s): ∫x^-s approximation. */
export function zipfCoverage(c: number, n: number, s: number): number {
  if (c >= n) return 1;
  if (c <= 0) return 0;
  const F = (x: number) => (Math.abs(s - 1) < 1e-6 ? Math.log(x) : (Math.pow(x, 1 - s) - 1) / (1 - s));
  return clamp((F(c) + 1) / (F(n) + 1), 0, 1);
}

const POLICY_FACTOR: Record<string, number> = { "allkeys-lru": 0.95, "allkeys-lfu": 1, "volatile-ttl": 0.85, noeviction: 1 };

export default defineComponent<Config, State>({
  kind: "redis",
  version: "1.0.0",
  name: "Redis cache",
  description: "In-memory cache with eviction, TTL, ops/sec ceiling and a hit ratio that emerges from memory, key skew and warmth.",
  category: "cache",
  icon: "database-zap",
  ports: [
    { id: "in", direction: "in", label: "Requests", protocols: ["cache-access", "tcp", "http"] },
    { id: "hit", direction: "out", label: "Hits", protocols: ["cache-access"], hidden: true },
    { id: "miss", direction: "out", label: "Misses & writes", protocols: ["database", "http", "grpc"] },
  ],
  defaults: { memoryMB: 1024, evictionPolicy: "allkeys-lru", ttlSec: 300, keyspace: 1_000_000, avgItemKB: 2, zipfSkew: 1.0, opsLimit: 80000, maxClients: 10000, baseLatencyMs: 0.5, costPerGBHour: 0.12 },
  fields: [
    { key: "memoryMB", label: "Max memory", type: "number", min: 16, max: 262144, step: 16, unit: "MB", scale: "log", group: "Memory" },
    { key: "evictionPolicy", label: "Eviction policy", type: "select", group: "Memory", options: [
      { value: "allkeys-lru", label: "allkeys-lru", hint: "Evict least recently used" },
      { value: "allkeys-lfu", label: "allkeys-lfu", hint: "Evict least frequently used; best for skewed keys" },
      { value: "volatile-ttl", label: "volatile-ttl", hint: "Evict keys closest to expiry" },
      { value: "noeviction", label: "noeviction", hint: "Reject writes when full" },
    ] },
    { key: "ttlSec", label: "Default TTL", type: "number", min: 0, max: 86400, step: 5, unit: "s", group: "Cache behaviour", help: "0 = keys never expire." },
    { key: "keyspace", label: "Distinct keys requested", type: "number", min: 1000, max: 1e9, step: 1000, scale: "log", group: "Cache behaviour" },
    { key: "avgItemKB", label: "Average item size", type: "number", min: 0.1, max: 1024, step: 0.1, unit: "KB", scale: "log", group: "Cache behaviour" },
    { key: "zipfSkew", label: "Key skew (Zipf s)", type: "number", editor: "zipf", min: 0, max: 2, step: 0.05, group: "Cache behaviour", help: "0 = uniform. ~1 = typical web popularity. Higher = a few hot keys dominate." },
    { key: "opsLimit", label: "Throughput limit", type: "number", min: 1000, max: 1_000_000, step: 1000, unit: "ops/s", scale: "log", group: "Limits", help: "Redis executes commands on one thread per shard." },
    { key: "maxClients", label: "Connection limit", type: "number", min: 10, max: 100000, step: 10, group: "Limits" },
    { key: "costPerGBHour", label: "Price per GB of memory", type: "number", min: 0, max: 5, step: 0.01, unit: "$/GB·h", group: "Cost" },
    { key: "baseLatencyMs", label: "Command latency", type: "number", min: 0.05, max: 20, step: 0.05, unit: "ms", group: "Limits" },
  ],
  costPerHour: (c) => (c.memoryMB / 1024) * c.costPerGBHour,
  presets: redisPresets,
  faults: [{ kind: "flush-cache", label: "Flush cache", description: "Drop every key; the DB takes the full load until it re-warms." }],
  derived(c) {
    const cap = Math.floor((c.memoryMB * 1024) / c.avgItemKB);
    const ratio = zipfCoverage(cap, c.keyspace, c.zipfSkew) * (POLICY_FACTOR[c.evictionPolicy] ?? 1);
    return [
      { label: "Items that fit", value: cap.toLocaleString(), tone: cap < c.keyspace ? "warn" : "ok", help: cap < c.keyspace ? "Keyspace exceeds memory: eviction churn." : "Whole keyspace fits." },
      { label: "Steady-state hit ratio (approx.)", value: `${(Math.min(1, ratio) * 100).toFixed(1)}%`, help: "Before TTL expiry. Approximation from Zipf coverage." },
    ];
  },
  metrics: [
    { id: "utilization", label: "Ops utilization", unit: "%" },
    { id: "hitRatio", label: "Hit ratio", unit: "%" },
    { id: "memory", label: "Memory used", unit: "%" },
    { id: "evictions", label: "Evictions", unit: "keys/s" },
    { id: "connections", label: "Connections", unit: "" },
    { id: "queueDepth", label: "Queue depth", unit: "ops" },
  ],
  docs: {
    summary: "Cache-aside layer. Reads that hit are answered here; misses and writes continue downstream.",
    models: ["Single-thread ops/sec ceiling with a bounded queue", "Hit ratio from Zipf key coverage of what fits in memory", "Cold start: cache fills as misses insert keys", "TTL expiry lowers effective hit ratio", "Connection limit via Little's law", "Cache flush fault"],
    simplifies: ["Hit ratio is analytic (Zipf coverage), not per-key; real LRU/LFU algorithm labs live in the playgrounds", "LRU/LFU/volatile-ttl differ by a fixed efficiency factor", "Writes are write-through and always pass downstream", "Single shard; no cluster resharding"],
    failureScenarios: ["Cold start after deploy or flush sends full load to the DB", "Cache stampede when a hot key expires (modeled via TTL churn)", "Eviction churn when the working set exceeds memory", "noeviction rejects writes at memory cap"],
    references: [{ title: "Redis eviction policies", url: "https://redis.io/docs/latest/develop/reference/eviction/" }],
  },
  init: () => ({ filled: 0, depth: 0, hit: 0, util: 0, evictPerSec: 0, memUtil: 0, clients: 0 }),
  validate: (_c, v) => v.outgoing.length === 0 ? [{ severity: "warn", message: "Misses have nowhere to go — connect the miss port to a database" }] : [],
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const cap = Math.max(1, Math.floor((c.memoryMB * 1024) / c.avgItemKB));
    const target = Math.min(cap, c.keyspace);
    let filled = s.filled;
    if (ctx.faults.some((f) => f.kind === "flush-cache" && f.justStarted)) {
      filled = 0;
      events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "cache-flushed", message: "Cache flushed — cold start" });
    }
    const q = stepQueue(s.depth, m.count, c.opsLimit * ctx.dt, c.opsLimit * ctx.dt * 0.25, ctx.dt);
    const rate = q.processed / ctx.dt;
    // connection pressure: in-flight ≈ rate × latency
    const clients = rate * (c.baseLatencyMs / 1000);
    const rejected = clients > c.maxClients ? q.processed * (1 - c.maxClients / clients) : 0;
    const served = q.processed - rejected;

    const warm = target > 0 ? clamp(filled / target, 0, 1) : 1;
    let ratio = zipfCoverage(target * warm, c.keyspace, c.zipfSkew) * (POLICY_FACTOR[c.evictionPolicy] ?? 1);
    if (c.ttlSec > 0) {
      const perKey = rate / Math.max(1, Math.min(c.keyspace, target));
      ratio *= 1 - 1 / (1 + perKey * c.ttlSec);
    }
    if (c.evictionPolicy === "noeviction" && filled >= cap) ratio *= 0.9;
    ratio = clamp(ratio, 0, 1);

    const reads = served * m.readFraction;
    const hits = reads * ratio;
    const passDown = served - hits;
    // each miss inserts a key until memory is full; beyond that it evicts one
    const inserts = reads - hits;
    const free = Math.max(0, cap - filled);
    const evicted = c.evictionPolicy === "noeviction" ? 0 : Math.max(0, inserts - free);
    filled = Math.min(cap, filled + inserts);
    if (s.filled < cap && filled >= cap && ctx.time > 0)
      events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "info", kind: "memory-full", message: "Cache memory full — eviction begins" });

    const lat = m.latencyMs + c.baseLatencyMs + q.waitMs;
    return {
      state: { filled, depth: q.depth, hit: served > 0 ? hits / served : s.hit, util: q.processed / (c.opsLimit * ctx.dt), evictPerSec: evicted / ctx.dt, memUtil: filled / cap, clients },
      outbound: [
        { port: "hit", count: hits, latencyMs: lat, readFraction: 1 },
        { port: "miss", count: passDown, latencyMs: lat, readFraction: passDown > 0 ? (reads - hits) / passDown : 0 },
      ],
      dropped: q.dropped + rejected,
      events,
    };
  },
  sample: (_c, s) => ({ utilization: s.util, hitRatio: s.hit, memory: s.memUtil, evictions: s.evictPerSec, connections: s.clients, queueDepth: s.depth }),
});
