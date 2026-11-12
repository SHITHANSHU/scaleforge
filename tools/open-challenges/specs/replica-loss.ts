import { flat, sc, users, type Spec } from "../kit";

const peak = flat(8000);
const lose = (index: number, at = 60) => [{ id: "f", kind: "fail-node", target: "kind:replicated-db", atSec: at, params: { index } }];

const app = (x = 260): [string, string, number, number, Record<string, number | string | boolean>] => ["app", "app-service", x, 220, { pods: 18, hpa: false }];

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "db-copy-lost-at-peak", title: "A database copy dies at peak", category: "Database Reliability", level: "intermediate", estimatedMinutes: 25,
    tags: ["availability", "replication", "stale reads", "failover"],
    summary: "Black Friday traffic, and one of the database machines just disappeared.",
    statement: {
      situation: "Your shop's catalogue and checkout run against a database that has so far been a single machine. Traffic on peak days reaches 8,000 requests/s and about 90% are reads. Last year a machine failed at the worst moment: reads timed out, support was flooded with 'my order disappeared' reports, and the on-call engineer spent the evening deciding what to do.",
      symptoms: ["Latency climbs and requests time out when a database machine is lost", "Some customers see old data after changing something", "Recovery depended on someone noticing and acting by hand"],
      requirements: ["Stay available through the loss of a database machine at peak", "Writes (orders) must resume quickly if the machine holding them fails", "Customers should rarely see stale data"],
      constraints: ["Database machines are a fixed size: you can add more, not make them bigger", "Budget: $4.00/hour all-in", "You decide how traffic reaches the database and what sits in front of it"],
    },
    background: "Test your design under the peak with a lost machine. A second, unannounced test removes a different machine.",
    learningObjectives: ["Capacity planning for N+1 failures", "Replication lag and stale reads", "Failover time and what it costs in write availability", "Offloading reads versus adding copies"],
    references: [{ title: "PostgreSQL: high availability, load balancing, replication", url: "https://www.postgresql.org/docs/current/warm-standby.html" }, { title: "AWS: Amazon RDS read replicas and Multi-AZ", url: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html" }, { title: "Amazon Aurora replication", url: "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html" }],
    resources: {
      allowed: ["load-balancer", "app-service", "redis", "replicated-db", "api-gateway"],
      budget: { maxCostPerHour: 4 },
      fixed: [users({ readRatio: 0.9, payloadKB: 2 })],
      kindDefaults: { "replicated-db": { readQps: 6000, writeQps: 1500, applyQps: 3000, costPerNodeHour: 0.35 }, "app-service": { cpuMsPerReq: 4, vcpuPerPod: 2, startupSec: 40 }, redis: { opsLimit: 80000 } },
      kindLocked: { "replicated-db": ["readQps", "writeQps", "applyQps", "costPerNodeHour"], "app-service": ["cpuMsPerReq", "vcpuPerPod", "startupSec"], redis: ["opsLimit"] },
    },
    scenarios: [{ id: "peak-loss", name: "Peak with a lost replica", description: "8,000 req/s for 3 minutes. A database machine is lost after one minute.", scenario: sc("Peak, replica lost", peak, 180, lose(1)) }],
    successCriteria: [
      { id: "avail", label: "Requests succeed (≥ 98.5% over each run, counting the failover)" }, { id: "latency", label: "p99 latency under 300 ms" }, { id: "stale", label: "Stale reads stay rare (< 5%)" },
      { id: "write-recover", label: "Writes recover within 40 s if the primary is lost" }, { id: "cost", label: "Within budget" },
    ],
    hints: ["After losing a machine, what's the load on each survivor?", "A database that fails can be replaced automatically; how long does that take?", "Reads don't all have to reach the database."],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [
      { id: "primary-loss", name: "Primary machine lost", scenario: sc("Primary lost", peak, 180, lose(0)) },
      { id: "higher-peak", name: "10% higher peak, replica lost", scenario: sc("Higher peak", flat(8800), 180, lose(2), { seed: 7 }) },
    ],
    criteria: [
      { id: "avail", label: "Overall availability ≥ 98.5%", hard: true, weight: 4, scenario: "all", metric: "e2e.availability", agg: "mean", op: ">=", value: 0.985, limit: 0.9 },
      { id: "latency", label: "p99 ≤ 300 ms", weight: 2, scenario: "all", metric: "e2e.p99", agg: "mean", after: 20, op: "<=", value: 300, limit: 1500 },
      { id: "stale", label: "Stale reads < 5%", weight: 2, scenario: "all", metric: "replicated-db.staleReadRate", agg: "mean", op: "<", value: 0.05, limit: 0.3 },
      { id: "write-recover", label: "Write downtime ≤ 40 s (primary loss)", hard: true, weight: 3, scenario: "primary-loss", metric: "replicated-db.downtimeSec", agg: "last", op: "<=", value: 40, limit: 120 },
      { id: "cost", label: "Cost ≤ $3.5/h (target)", weight: 1, scenario: "peak-loss", metric: "e2e.costPerHour", agg: "last", op: "<=", value: 3.5, limit: 4 },
    ],
  },
  writeup: `
The failure that hurts is not the loss of one machine, it is what the survivors do next. At 8,000 req/s with 90% reads, a single database machine cannot serve the reads, so any design that leans on one or two copies collapses the moment one disappears. Two levers work: add enough copies that the survivors can absorb the load (N+1 sizing), or stop most reads reaching the database at all with a cache.

Failover is the second half. Automatic promotion with a short detection time keeps the write outage to tens of seconds; waiting for a human costs minutes. Synchronous replication removes data loss on promotion at the price of commit latency, but is not needed to pass here.

Stale reads come from replica lag: spreading reads over replicas is cheap but can show old data, while lag-aware routing falls back to the primary when a replica is behind. Several designs pass: more replicas with lag-aware routing, a cache plus fewer replicas, or a mix. What they trade is cost, staleness and how much work the primary carries.
`,
  reference: {
    nodes: [app(), ["db", "replicated-db", 560, 220, { replicas: 4, readRouting: "lag-aware", maxStalenessSec: 2, failover: "auto", detectSec: 8, promoteSec: 12 }]],
    edges: [["users", "out", "app", "in"], ["app", "out", "db", "in"]],
  },
  alternatives: {
    "cache-plus-two-replicas": {
      nodes: [app(), ["cache", "redis", 420, 120, { memoryMB: 2048, keyspace: 300000, avgItemKB: 2, ttlSec: 60, zipfSkew: 1.1 }], ["db", "replicated-db", 640, 220, { replicas: 2, readRouting: "lag-aware", maxStalenessSec: 2, failover: "auto", detectSec: 8, promoteSec: 12 }]],
      edges: [["users", "out", "app", "in"], ["app", "cache", "cache", "in"], ["app", "db", "db", "in"], ["cache", "miss", "db", "in"]],
    },
  },
  attempts: {
    "single-primary": { nodes: [app(), ["db", "replicated-db", 560, 220, { replicas: 0 }]], edges: [["users", "out", "app", "in"], ["app", "out", "db", "in"]] },
    "two-replicas-manual": { nodes: [app(), ["db", "replicated-db", 560, 220, { replicas: 2, failover: "manual", manualResponseSec: 300 }]], edges: [["users", "out", "app", "in"], ["app", "out", "db", "in"]] },
  },
};
