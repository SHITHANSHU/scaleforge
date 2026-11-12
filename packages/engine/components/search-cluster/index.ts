import { defineComponent } from "../../core/define";
import { clamp, mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config {
  dataNodes: number; shards: number; replicas: number; docsMillions: number; nodeCpu: number;
  queryCostMs: number; heavyQueryPct: number; heavyMultiplier: number; perShardOverheadMs: number;
  indexCostMs: number; refreshSec: number; queueLimit: number; costPerNodeHour: number;
  [k: string]: number;
}
interface State { qDepth: number; iDepth: number; qUtil: number; iUtil: number; indexLagSec: number; rejected: number; lat: number; qServed: number; fresh: number; nodesDown: number }

export default defineComponent<Config, State>({
  kind: "search-cluster",
  version: "1.0.0",
  name: "Search cluster",
  description: "A sharded, replicated search index: queries fan out to every shard while indexing competes for the same nodes.",
  category: "data",
  icon: "search",
  ports: [
    { id: "query", direction: "in", label: "Queries", protocols: ["http", "grpc"] },
    { id: "index", direction: "in", label: "Index updates", protocols: ["http", "message-queue", "event-stream"] },
    { id: "result", direction: "out", label: "Results", protocols: ["http"], hidden: true },
  ],
  defaults: { dataNodes: 4, shards: 8, replicas: 1, docsMillions: 40, nodeCpu: 8, queryCostMs: 2.5, heavyQueryPct: 5, heavyMultiplier: 12, perShardOverheadMs: 0.15, indexCostMs: 0.6, refreshSec: 1, queueLimit: 2000, costPerNodeHour: 0.5 },
  fields: [
    { key: "dataNodes", label: "Data nodes", type: "number", min: 1, max: 100, step: 1, group: "Cluster" },
    { key: "shards", label: "Primary shards", type: "number", min: 1, max: 500, step: 1, group: "Cluster", help: "Every query touches every shard. Too few → huge shards; too many → per-shard overhead on every query." },
    { key: "replicas", label: "Replicas per shard", type: "number", min: 0, max: 4, step: 1, group: "Cluster", help: "Replicas add query capacity and availability, and cost indexing work." },
    { key: "docsMillions", label: "Documents", type: "number", min: 0.1, max: 10000, step: 0.1, unit: "M", scale: "log", group: "Data" },
    { key: "nodeCpu", label: "CPU cores per node", type: "number", min: 1, max: 128, step: 1, group: "Capacity" },
    { key: "queryCostMs", label: "Query cost per 1M docs/shard", type: "number", min: 0.1, max: 500, step: 0.1, unit: "ms", scale: "log", group: "Queries", help: "CPU-ms for a typical query over a 1M-doc shard. Cost grows sub-linearly with shard size (approximation)." },
    { key: "heavyQueryPct", label: "Expensive queries", type: "number", min: 0, max: 100, step: 1, unit: "%", group: "Queries", help: "Wildcard/aggregation-style queries that cost many times more." },
    { key: "heavyMultiplier", label: "Expensive query multiplier", type: "number", min: 1, max: 200, step: 1, unit: "×", group: "Queries" },
    { key: "perShardOverheadMs", label: "Per-shard overhead", type: "number", min: 0, max: 5, step: 0.01, unit: "ms", group: "Queries", help: "Fixed cost each shard adds to every query." },
    { key: "indexCostMs", label: "Indexing cost per doc", type: "number", min: 0.01, max: 50, step: 0.01, unit: "ms", scale: "log", group: "Indexing" },
    { key: "refreshSec", label: "Refresh interval", type: "number", min: 0.1, max: 60, step: 0.1, unit: "s", group: "Indexing", help: "How often new docs become searchable. Shorter = fresher but costs more indexing work." },
    { key: "queueLimit", label: "Request queue", type: "number", min: 10, max: 1e6, step: 10, scale: "log", group: "Capacity", help: "Beyond this, requests are rejected (like HTTP 429)." },
    { key: "costPerNodeHour", label: "Price per node", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
  ],
  presets: [],
  faults: [{ kind: "fail-node", label: "Fail a data node", description: "A node leaves the cluster. Its shards need replicas elsewhere, or results are partial." }],
  costPerHour: (c) => c.dataNodes * c.costPerNodeHour,
  derived(c) {
    const copies = c.shards * (1 + c.replicas);
    const docsPerShard = c.docsMillions / c.shards;
    return [
      { label: "Shard copies", value: `${copies} (${(copies / c.dataNodes).toFixed(1)} per node)`, tone: copies / c.dataNodes > 20 ? "warn" : "ok" },
      { label: "Docs per shard", value: `${docsPerShard.toFixed(1)} M`, tone: docsPerShard > 50 ? "warn" : docsPerShard < 0.05 ? "warn" : "ok", help: docsPerShard > 50 ? "Very large shards: slow queries, slow recovery." : docsPerShard < 0.05 ? "Over-sharded: per-shard overhead dominates." : undefined },
      { label: "Search staleness", value: `≤ ${c.refreshSec} s + indexing lag`, help: "New documents appear after the next refresh." },
    ];
  },
  metrics: [
    { id: "utilization", label: "Query CPU", unit: "%" },
    { id: "indexUtil", label: "Indexing CPU", unit: "%" },
    { id: "indexLagSec", label: "Indexing lag", unit: "s" },
    { id: "freshnessSec", label: "Result freshness", unit: "s" },
    { id: "rejected", label: "Rejected (429)", unit: "req/s" },
    { id: "latencyMs", label: "Query latency", unit: "ms" },
    { id: "queueDepth", label: "Queued", unit: "req" },
  ],
  docs: {
    summary: "Search nodes hold shards; every query fans out to one copy of each shard and returns when the slowest answers.",
    models: [
      "Query cost grows with documents per shard (sub-linearly) and with a per-shard fixed overhead — so both under- and over-sharding hurt",
      "Query latency set by the slowest shard, worse when nodes are busy",
      "Expensive queries as a share of traffic with a cost multiplier",
      "Indexing and queries share node CPU; heavy indexing starves queries and vice-versa",
      "Refresh interval trading freshness against indexing cost",
      "Replicas adding query capacity and indexing cost; node loss causing partial results when there are no replicas",
      "Bounded queues rejecting with 429",
    ],
    simplifies: [
      "No JVM heap, garbage collection, segment merging or mapping-explosion behaviour; the sources consulted do not give numbers for these, so none are modelled",
      "Shards are evenly sized and evenly placed",
      "Cost curves are approximations to be calibrated by the user",
      "No query caching, routing or per-field costs",
    ],
    failureScenarios: ["Bulk re-import starves live queries", "Over-sharding: tiny shards make every query slow", "Under-sharding: huge shards", "Node loss without replicas returns partial results", "Queues full → 429s"],
    references: [
      { title: "Elastic docs: size your shards", url: "https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards" },
      { title: "Elastic docs: tune for indexing speed", url: "https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed" },
    ],
  },
  init: (c) => ({ qDepth: 0, iDepth: 0, qUtil: 0, iUtil: 0, indexLagSec: 0, rejected: 0, lat: c.queryCostMs, qServed: 0, fresh: c.refreshSec, nodesDown: 0 }),
  validate: (c, v) => [
    ...(v.incoming.length === 0 ? [{ severity: "info" as const, message: "Nothing queries or indexes this cluster yet" }] : []),
    ...(c.shards / c.dataNodes > 10 ? [{ severity: "warn" as const, field: "shards", message: "Many shards per node: expect high overhead" }] : []),
    ...(c.replicas === 0 ? [{ severity: "info" as const, field: "replicas", message: "No replicas: losing a node loses part of the index" }] : []),
  ],
  tick(ctx, c, s, inbound) {
    const events: SimEvent[] = [];
    const q = mergeInflows(inbound.filter((f) => f.port === "query"));
    const ix = mergeInflows(inbound.filter((f) => f.port === "index"));
    const down = new Set<number>();
    for (const f of ctx.faults) if (f.kind === "fail-node") down.add(Number(f.params.index ?? 0));
    const nodesDown = [...down].filter((i) => i < c.dataNodes).length;
    const liveNodes = Math.max(0, c.dataNodes - nodesDown);
    // a shard is fully lost if all its copies sat on down nodes; with replicas the chance is tiny, without it's proportional
    const copies = 1 + c.replicas;
    // copies of a shard live on different nodes, so a shard is only lost once as many nodes are down as it has copies
    const lostShardFrac = nodesDown < copies ? (c.replicas === 0 ? nodesDown / c.dataNodes : 0) : Math.pow(nodesDown / c.dataNodes, copies);
    const partial = lostShardFrac > 0 ? 1 - lostShardFrac : 1;

    const cpuMs = liveNodes * c.nodeCpu * 1000 * ctx.dt; // CPU-ms available this tick across live nodes
    const docsPerShard = c.docsMillions / c.shards;
    const perShardMs = c.queryCostMs * Math.pow(Math.max(docsPerShard, 0.01), 0.7);
    const avgQueryCost = (c.shards * (perShardMs + c.perShardOverheadMs)) * (1 + (c.heavyQueryPct / 100) * (c.heavyMultiplier - 1));
    // refresh cost: shorter intervals create more segments to write
    const refreshFactor = 1 + 1 / Math.max(0.1, c.refreshSec) * 0.25;
    const indexCost = c.indexCostMs * copies * refreshFactor;

    // indexing gets what it asks for first up to a cap of 60% CPU; queries take the rest (a fair-share approximation)
    const iWant = (s.iDepth + ix.count) * indexCost;
    const iAlloc = Math.min(iWant, cpuMs * 0.6);
    const qWant = (s.qDepth + q.count) * avgQueryCost;
    const qAlloc = Math.min(qWant, cpuMs - iAlloc);
    const iDone = indexCost > 0 ? iAlloc / indexCost : 0, qDone = avgQueryCost > 0 ? qAlloc / avgQueryCost : 0;
    let iDepth = s.iDepth + ix.count - iDone, qDepth = s.qDepth + q.count - qDone;
    const rejectedQ = Math.max(0, qDepth - c.queueLimit), rejectedI = Math.max(0, iDepth - c.queueLimit * 5);
    qDepth -= rejectedQ; iDepth -= rejectedI;
    const qRate = qDone / ctx.dt;
    const qUtil = cpuMs > 0 ? qAlloc / cpuMs : 0, iUtil = cpuMs > 0 ? iAlloc / cpuMs : 0;
    const busy = clamp(qUtil + iUtil, 0, 0.98);
    // latency: slowest shard under load (+ queueing)
    const serviceMs = perShardMs * (1 + (c.heavyQueryPct / 100) * (c.heavyMultiplier - 1) * 0.3) + c.perShardOverheadMs * c.shards * 0.3;
    const wait = qRate > 0 ? (qDepth / qRate) * 1000 : qDepth > 0 ? 5000 : 0;
    const lat = serviceMs / (1 - busy * 0.85) * (1 + 0.1 * Math.log2(Math.max(1, c.shards))) + wait;
    const indexLagSec = iDone > 0 ? iDepth / (iDone / ctx.dt) : iDepth > 0 ? 3600 : 0;
    if (rejectedQ > 0 && s.rejected === 0) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "rejecting", message: "Request queue full — rejecting queries (429)" });
    if (nodesDown > 0 && s.nodesDown === 0) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: partial < 1 ? "error" : "warn", kind: "node-down", message: `${nodesDown} data node(s) down${partial < 1 ? ` — ${(lostShardFrac * 100).toFixed(0)}% of shards unavailable: partial results` : ""}` });
    return {
      state: { qDepth, iDepth, qUtil, iUtil, indexLagSec, rejected: (rejectedQ + rejectedI) / ctx.dt, lat, qServed: qRate, fresh: c.refreshSec + indexLagSec, nodesDown },
      outbound: [
        { port: "result", count: qDone * partial, latencyMs: q.latencyMs + lat, readFraction: 1 },
        { port: "result", count: iDone, latencyMs: 0, readFraction: 0, silent: true }, // documents indexed: served, but nobody waits on them
      ],
      dropped: rejectedQ + rejectedI + qDone * (1 - partial), events,
    };
  },
  sample: (_c, s) => ({ utilization: clamp(s.qUtil + s.iUtil, 0, 1), indexUtil: s.iUtil, indexLagSec: s.indexLagSec, freshnessSec: s.fresh, rejected: s.rejected, latencyMs: s.lat, queueDepth: s.qDepth }),
});
