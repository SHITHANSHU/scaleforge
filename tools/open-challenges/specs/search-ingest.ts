import { sc, type Spec } from "../kit";

const search = (cfg = {}) => ({ id: "catalog", kind: "search-cluster", label: "Product search", x: 700, y: 220, locked: ["queryCostMs", "indexCostMs", "nodeCpu", "costPerNodeHour", "docsMillions", "heavyQueryPct", "heavyMultiplier", "perShardOverheadMs"] as string[], config: { docsMillions: 20, nodeCpu: 8, queryCostMs: 0.8, indexCostMs: 0.6, heavyQueryPct: 6, heavyMultiplier: 12, perShardOverheadMs: 0.15, costPerNodeHour: 0.5, dataNodes: 3, shards: 6, replicas: 1, ...cfg } });
// shares are of the scenario RPS (10,000): searchers 6% = 600 req/s, ingest 60% = 6,000 docs/s
const searchers = { id: "shoppers", kind: "client", label: "Shoppers (queries)", x: 0, y: 140, locked: true as const, config: { share: 6, readRatio: 1 } };
const importer = { id: "importer", kind: "client", label: "Catalog import (documents)", x: 0, y: 320, locked: true as const, config: { share: 60, readRatio: 0 } };
const T = { type: "constant" as const, rps: 10000 };

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "search-slows-during-import", title: "Search is fast — until the catalogue import runs", category: "Performance Engineering", level: "advanced", estimatedMinutes: 35,
    tags: ["search", "indexing", "sharding", "resource contention", "backpressure"],
    summary: "Query latency triples whenever documents are being indexed.",
    statement: {
      situation: "Your product search serves about 600 queries/s over 20 million documents. A supplier feed continuously pushes around 6,000 document updates per second. The search cluster is already deployed in front of you (three nodes) but the people who run it say it falls over whenever the feed is running at full speed.",
      symptoms: ["Search latency spikes while the feed is active", "New products take minutes to become searchable", "Occasionally queries are rejected with 429s"],
      requirements: ["Search p99 under 250 ms while the feed runs", "New documents searchable within 10 seconds", "No queries rejected"],
      constraints: ["Budget: $4.00/hour including the cluster", "The cluster's node size, document count and per-query cost are fixed", "You can change how the cluster is shaped and what sits between the feed and it"],
    },
    learningObjectives: ["Indexing and query workloads competing for the same resources", "Shard count trade-offs: too few vs too many", "Freshness vs indexing cost (refresh interval)", "Buffering and shaping ingest so it can't starve queries"],
    references: [{ title: "Elastic docs: size your shards", url: "https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards" }, { title: "Elastic docs: tune for indexing speed", url: "https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed" }],
    resources: {
      allowed: ["search-cluster", "kafka", "rabbitmq", "rate-limiter", "api-gateway", "load-balancer"],
      budget: { maxCostPerHour: 4 },
      fixed: [searchers, importer, search()],
      fixedEdges: [
        { id: "fx-q", from: "shoppers", fromPort: "out", to: "catalog", toPort: "query", protocol: "http", latencyMs: 1 },
        { id: "fx-i", from: "importer", fromPort: "out", to: "catalog", toPort: "index", protocol: "http", latencyMs: 1 },
      ],
      kindDefaults: { kafka: { consumerRate: 2000 }, rabbitmq: { consumerRate: 2000 } },
      kindLocked: { kafka: ["consumerRate"], rabbitmq: ["consumerRate"] },
    },
    scenarios: [{ id: "feed", name: "Continuous feed at full speed", description: "600 queries/s while 6,000 documents/s are being indexed, for 5 minutes.", scenario: sc("Feed running", T, 300, [], { tickMs: 20 }) }],
    successCriteria: [{ id: "latency", label: "Search p99 ≤ 250 ms" }, { id: "fresh", label: "New documents searchable within 10 s" }, { id: "reject", label: "No queries rejected (errors ≤ 0.5%)" }, { id: "cost", label: "Within budget" }],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [
      { id: "node-loss", name: "A search node is lost mid-run", scenario: sc("Node lost", T, 300, [{ id: "n", kind: "fail-node", target: "catalog", atSec: 120, params: { index: 0 } }], { tickMs: 20, seed: 6 }) },
      { id: "heavier", name: "Feed 30% heavier", scenario: sc("Heavier feed", { type: "constant", rps: 12000 }, 300, [], { tickMs: 20, seed: 7 }) },
    ],
    criteria: [
      { id: "errors", label: "Errors ≤ 0.5%", hard: true, weight: 4, scenario: "all", metric: "e2e.errorRate", agg: "mean", after: 20, op: "<=", value: 0.005, limit: 0.1 },
      { id: "latency", label: "p99 ≤ 250 ms", hard: true, weight: 4, scenario: "all", metric: "e2e.p99", agg: "mean", after: 30, op: "<=", value: 250, limit: 2000 },
      { id: "fresh", label: "Result freshness ≤ 10 s", weight: 3, scenario: "all", metric: "search-cluster.freshnessSec", agg: "max", after: 30, op: "<=", value: 10, limit: 120 },
    ],
  },
  writeup: `
Indexing and querying draw on the same CPUs, so a feed that is 'only' a background process can consume most of the cluster. Two honest approaches exist. Give the cluster more room: more nodes (and replicas for availability), shard counts that avoid both huge shards and per-shard overhead on every query, and a longer refresh interval so indexing does less work per document at the cost of freshness. Or shape the ingest: put a buffer between the feed and the cluster so indexing proceeds at a rate the cluster can sustain without starving queries.

Neither is free. More nodes cost money every hour; a longer refresh makes new products appear later; a buffer adds lag and a component to operate. The decision the challenge is really testing is whether you notice that the problem is contention rather than capacity, and pick the lever that costs least for the requirement.
`,
  reference: {
    nodes: [],
    edges: [],
    patch: { catalog: { dataNodes: 5, shards: 8, replicas: 1, refreshSec: 5 } },
  },
  alternatives: {
    "buffered-ingest": {
      nodes: [["buf", "kafka", 300, 360, { partitions: 6, consumers: 3, commitMode: "manual" }]],
      edges: [["importer", "out", "buf", "produce"], ["buf", "consume", "catalog", "index"]],
      drop: ["fx-i"],
      patch: { catalog: { dataNodes: 4, shards: 8, replicas: 1, refreshSec: 10 } },
    },
  },
  attempts: {
    "as-deployed": { nodes: [], edges: [] },
    "more-shards-only": { nodes: [], edges: [], patch: { catalog: { shards: 60 } } },
  },
};
