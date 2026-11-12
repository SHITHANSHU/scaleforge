import { sc, users, type Spec } from "../kit";

const client = { readRatio: 0.95, retries: 2, backoffMs: 150, backoffMultiplier: 2, jitter: 0.5, retryBudgetPct: 100 };
const outage = (at = 60, until = 300) => [
  { id: "down", kind: "kill-node", target: "kind:redis", atSec: at, untilSec: until },
  { id: "cold", kind: "flush-cache", target: "kind:redis", atSec: until },
];
const T = { type: "constant" as const, rps: 6000 };

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "cache-gone-database-melts", title: "When the cache disappears", category: "Caching", level: "advanced", estimatedMinutes: 30,
    tags: ["cache failure", "cascading failure", "load shedding", "fail-open"],
    summary: "The layer that absorbs 95% of your reads just went away.",
    statement: {
      situation: "A content site serves 6,000 requests/s, almost all reads. A cache layer normally answers nearly everything, and the database behind it is sized for the leftover trickle. During a routine maintenance window the entire cache layer becomes unavailable for four minutes and then returns empty.",
      symptoms: ["The database suddenly receives most of the traffic", "Connections fill, latency rises, errors follow, and retries make it worse", "When the cache returns it is empty and the database takes another hit"],
      requirements: ["Keep the site usable during the outage — degrade, don't collapse", "The database must survive, and the system must return to normal after the cache comes back", "Retries from clients (two, with backoff) must not finish it off"],
      constraints: ["Budget: $4.00/hour", "Database machines have a fixed size", "You can't change client retry behaviour"],
    },
    learningObjectives: ["Fail-open versus fail-closed", "Bounding load on a dependency", "Why the recovery (cold cache) is its own incident", "Capacity for the worst case versus protecting capacity"],
    references: [{ title: "Facebook: Scaling Memcache at Facebook (NSDI '13)", url: "https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf" }, { title: "AWS Builders' Library: Timeouts, retries and backoff with jitter", url: "https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/" }],
    resources: {
      allowed: ["load-balancer", "api-gateway", "app-service", "redis", "replicated-db", "rate-limiter"],
      budget: { maxCostPerHour: 4 },
      fixed: [users(client)],
      kindDefaults: { "app-service": { cpuMsPerReq: 3, vcpuPerPod: 2, startupSec: 40 }, "replicated-db": { readQps: 5000, writeQps: 1500, maxConnections: 400, costPerNodeHour: 0.35 }, redis: { opsLimit: 80000 } },
      kindLocked: { "app-service": ["cpuMsPerReq", "vcpuPerPod", "startupSec"], "replicated-db": ["readQps", "writeQps", "costPerNodeHour"], redis: ["opsLimit"] },
    },
    scenarios: [{ id: "outage", name: "Cache layer lost for 4 minutes", description: "6,000 req/s. The whole cache layer fails at t=60 s and returns empty at t=300 s.", scenario: sc("Cache outage", T, 420, outage()) }],
    successCriteria: [
      { id: "avail", label: "At least 80% of requests succeed during the outage" }, { id: "db", label: "The database is never driven into collapse" },
      { id: "recover", label: "Back to ≥ 98% availability within 90 s of the cache returning" }, { id: "latency", label: "p99 ≤ 800 ms" }, { id: "cost", label: "Within budget" },
    ],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [{ id: "longer", name: "Outage at 8,000 req/s", scenario: sc("Cache outage, higher load", { type: "constant", rps: 8000 }, 420, outage(50, 280), { seed: 5 }) }],
    criteria: [
      { id: "avail", label: "Availability during the outage ≥ 80%", hard: true, weight: 4, scenario: "all", metric: "e2e.availability", agg: "mean", after: 75, before: 270, op: ">=", value: 0.8, limit: 0.3 },
      { id: "recover", label: "Settles ≥ 98% within 90 s of cache return", hard: true, weight: 3, scenario: "outage", metric: "e2e.availability", agg: "settleSec", after: 300, settle: 0.98, op: "<=", value: 90, limit: 200 },
      { id: "latency", label: "p99 ≤ 800 ms", weight: 2, scenario: "all", metric: "e2e.p99", agg: "mean", after: 75, before: 270, op: "<=", value: 800, limit: 4000 },
      { id: "retry", label: "Retry load ≤ 1× offered", weight: 1, scenario: "all", metric: "e2e.retryRatio", agg: "max", op: "<=", value: 1, limit: 2.5 },
    ],
  },
  writeup: `
The database was sized for a trickle, so the instant the cache vanishes there are only three honest options: have capacity for the full read load, serve less (shed) so the database stays alive, or serve something other than fresh data. Doing nothing sends everything to the database and loses all of it, including the writes.

Failing open — letting the application read through to the database when the cache is down — keeps requests working, and is exactly what overloads the database. So fail-open needs a limiter on the path to the database (a gateway shedding by queue age works) and/or enough database capacity. Either approach passes; they trade cost (more database machines, 24/7) against availability during the outage (shedding rejects some requests but protects everyone else).

The cache's return is its own incident: it comes back empty, every request is a miss, and the database takes the full load again until it warms. Designs that protect the database help twice.
`,
  reference: {
    nodes: [
      ["app", "app-service", 260, 220, { pods: 12, hpa: false, cacheFallback: true }],
      ["r", "redis", 520, 120, { memoryMB: 4096, keyspace: 300000, avgItemKB: 2, ttlSec: 300, zipfSkew: 1.2 }],
      ["gw", "api-gateway", 520, 330, { capacityRps: 20000, shedding: true, maxQueueAgeMs: 80, breaker: false }],
      ["db", "replicated-db", 780, 220, { replicas: 2, readRouting: "replicas", maxConnections: 400 }],
    ],
    edges: [["users", "out", "app", "in"], ["app", "cache", "r", "in"], ["app", "db", "gw", "in"], ["gw", "out", "db", "in"], ["r", "miss", "db", "in"]],
  },
  alternatives: {
    "big-database": {
      nodes: [
        ["app", "app-service", 260, 220, { pods: 12, hpa: false, cacheFallback: true }],
        ["r", "redis", 520, 120, { memoryMB: 2048, keyspace: 300000, avgItemKB: 2, ttlSec: 300, zipfSkew: 1.2 }],
        ["db", "replicated-db", 780, 220, { replicas: 4, readRouting: "replicas", maxConnections: 600 }],
      ],
      edges: [["users", "out", "app", "in"], ["app", "cache", "r", "in"], ["app", "db", "db", "in"], ["r", "miss", "db", "in"]],
    },
  },
  attempts: {
    "fail-closed": {
      nodes: [["app", "app-service", 260, 220, { pods: 12, hpa: false, cacheFallback: false }], ["r", "redis", 520, 120, { memoryMB: 4096, keyspace: 300000, avgItemKB: 2, ttlSec: 300, zipfSkew: 1.2 }], ["db", "replicated-db", 780, 220, { replicas: 1 }]],
      edges: [["users", "out", "app", "in"], ["app", "cache", "r", "in"], ["app", "db", "db", "in"], ["r", "miss", "db", "in"]],
    },
    "fail-open-small-db": {
      nodes: [["app", "app-service", 260, 220, { pods: 12, hpa: false, cacheFallback: true }], ["r", "redis", 520, 120, { memoryMB: 4096, keyspace: 300000, avgItemKB: 2, ttlSec: 300, zipfSkew: 1.2 }], ["db", "replicated-db", 780, 220, { replicas: 1 }]],
      edges: [["users", "out", "app", "in"], ["app", "cache", "r", "in"], ["app", "db", "db", "in"], ["r", "miss", "db", "in"]],
    },
  },
};
