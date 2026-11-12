import { sc, users, type Spec } from "../kit";

const regionA = { id: "regionA", kind: "boundary", label: "Region A", x: 220, y: 40, w: 560, h: 440 };
const regionB = { id: "regionB", kind: "boundary", label: "Region B", x: 840, y: 40, w: 560, h: 440 };
const loss = (at = 90) => [{ id: "regionA-down", kind: "kill-node", target: "regionA", atSec: at }];
const T = { type: "constant" as const, rps: 4000 };

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "a-whole-region-disappears", title: "A whole region disappears", category: "Multi-region Architecture", level: "senior", estimatedMinutes: 45,
    tags: ["multi-region", "failover", "RPO", "RTO", "data durability", "DNS"],
    summary: "Region A goes dark. Users must keep working, and nothing they wrote may be lost.",
    statement: {
      situation: "Your application serves 4,000 requests/s (about 10% writes — orders and profile changes) from the primary region, Region A. A second region, Region B, exists but has never carried production traffic. At 90 seconds a power event takes Region A completely offline and it does not come back during the incident. The link between regions has an 80 ms round trip.",
      symptoms: ["Every request fails until someone repoints traffic", "The database in the dead region held the only copy of the most recent writes", "When failover finally happens, users report missing orders"],
      requirements: ["Return to ≥ 99% success within 60 seconds of the outage", "Lose no more than 200 acknowledged writes", "Keep p99 latency under 500 ms when serving from the surviving region"],
      constraints: ["Budget: $8.00/hour for the whole deployment", "Anything in a region goes down with it — place components deliberately", "The users' entry point sits outside both regions", "Cross-region calls pay the 80 ms round trip"],
    },
    background: "Drag components into Region A or Region B. Edges that cross between regions add the round-trip time automatically.",
    learningObjectives: ["Failure domains and static stability", "RPO vs latency: synchronous vs asynchronous replication across regions", "Failover detection and client caching delays", "Active-passive vs active-active trade-offs"],
    references: [{ title: "AWS Builders' Library: Static stability using Availability Zones", url: "https://builder.aws.com/content/3K9SiqiJ369TGkkGzqPM95BuYWI/static-stability-using-availability-zones" }, { title: "GitHub: October 21 post-incident analysis", url: "https://github.blog/news-insights/company-news/oct21-post-incident-analysis/" }, { title: "AWS post-event summary: us-east-1, 19-20 Oct 2025 (DNS effects on recovery)", url: "https://aws.amazon.com/message/101925/" }],
    resources: {
      allowed: ["load-balancer", "app-service", "replicated-db", "quorum-kv", "api-gateway", "redis"],
      budget: { maxCostPerHour: 8 },
      fixed: [users({ readRatio: 0.9 }, 0, 260), regionA, regionB],
      kindDefaults: { "app-service": { cpuMsPerReq: 6, vcpuPerPod: 2, startupSec: 30, costPerPodHour: 0.09, hpa: false }, "replicated-db": { readQps: 6000, writeQps: 1500, applyQps: 3000, costPerNodeHour: 0.35 }, "quorum-kv": { nodeQps: 6000, costPerNodeHour: 0.35 } },
      kindLocked: { "app-service": ["cpuMsPerReq", "vcpuPerPod", "startupSec", "costPerPodHour"], "replicated-db": ["readQps", "writeQps", "applyQps", "costPerNodeHour"], "quorum-kv": ["nodeQps", "costPerNodeHour"] },
    },
    scenarios: [{ id: "region-loss", name: "Region A is lost at t=90 s", description: "4,000 req/s for 6 minutes. Region A goes offline at t=90 s and stays down. Cross-region round trip: 80 ms.", scenario: sc("Region A lost", T, 360, loss(), { regionRttMs: 80 }) }],
    successCriteria: [
      { id: "recover", label: "≥ 99% of requests succeed within 60 s of the outage" }, { id: "rpo", label: "At most 200 acknowledged writes lost" }, { id: "latency", label: "p99 ≤ 500 ms afterwards" }, { id: "cost", label: "Within budget" },
    ],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [{ id: "late", name: "Outage at 5,000 req/s, later in the run", scenario: sc("Late outage", { type: "constant", rps: 5000 }, 400, loss(150), { regionRttMs: 80, seed: 12 }) }],
    criteria: [
      { id: "recover", label: "≥ 99% success within 60 s of the outage", hard: true, weight: 4, scenario: "region-loss", metric: "e2e.availability", agg: "settleSec", after: 90, settle: 0.99, op: "<=", value: 60, limit: 180 },
      { id: "recover-late", label: "…and in the later outage", hard: true, weight: 2, scenario: "late", metric: "e2e.availability", agg: "settleSec", after: 150, settle: 0.99, op: "<=", value: 60, limit: 180 },
      { id: "rpo", label: "Lost writes ≤ 200", hard: true, weight: 4, scenario: "all", metric: "replicated-db.dataLoss", agg: "last", nodeAgg: "sum", op: "<=", value: 200, limit: 5000 },
      { id: "latency", label: "p99 ≤ 500 ms after recovery", weight: 2, scenario: "all", metric: "e2e.p99", agg: "mean", after: 200, op: "<=", value: 500, limit: 2000 },
    ],
  },
  writeup: `
The shape of the answer is dictated by what lives where. Anything in Region A is gone, so the surviving region needs enough application capacity already running (static stability — scaling up during an outage depends on control planes that may be impaired) and a database copy that is both outside Region A and current.

The data decision is a latency/durability trade. A synchronous copy in Region B guarantees no acknowledged write is lost, at the cost of an extra 80 ms on every write. An asynchronous copy keeps writes fast but loses whatever had not yet shipped — the shipping delay times the write rate — which is how real regional failovers lose data. The requirement of ≤ 200 lost writes rules out a loose async setup.

Traffic must also move: an active-passive balancer fails over after health checks notice, so detection time is part of your recovery time; clients that cache old answers stretch it further. Active-active spreads load across both regions all the time and can recover faster, but needs the surviving region to carry the whole load.
`,
  reference: {
    nodes: [
      ["lb", "load-balancer", 120, 260, { algorithm: "failover", checkIntervalSec: 2, unhealthyThreshold: 2, dnsTtlSec: 0 }],
      ["appA", "app-service", 340, 160, { pods: 16 }],
      ["appB", "app-service", 960, 160, { pods: 16 }],
      ["db", "replicated-db", 560, 340, { replicas: 2, replicaPlacement: "other-region", replication: "sync", syncCopies: 1, syncRttMs: 80, detectSec: 5, promoteSec: 10, readRouting: "replicas" }],
    ],
    edges: [["users", "out", "lb", "in"], ["lb", "out", "appA", "in"], ["lb", "out", "appB", "in"], ["appA", "db", "db", "in"], ["appB", "db", "db", "in"]],
  },
  alternatives: {
    "active-active-sync": {
      nodes: [
        ["lb", "load-balancer", 120, 260, { algorithm: "round-robin", checkIntervalSec: 2, unhealthyThreshold: 2 }],
        ["appA", "app-service", 340, 160, { pods: 16 }],
        ["appB", "app-service", 960, 160, { pods: 16 }],
        ["db", "replicated-db", 560, 340, { replicas: 2, replicaPlacement: "other-region", replication: "sync", syncCopies: 1, syncRttMs: 80, detectSec: 5, promoteSec: 10 }],
      ],
      edges: [["users", "out", "lb", "in"], ["lb", "out", "appA", "in"], ["lb", "out", "appB", "in"], ["appA", "db", "db", "in"], ["appB", "db", "db", "in"]],
    },
  },
  attempts: {
    "single-region": { nodes: [["appA", "app-service", 340, 160, { pods: 16 }], ["db", "replicated-db", 560, 340, { replicas: 2 }]], edges: [["users", "out", "appA", "in"], ["appA", "db", "db", "in"]] },
    "db-stays-in-A": {
      nodes: [["lb", "load-balancer", 120, 260, { algorithm: "failover", checkIntervalSec: 2, unhealthyThreshold: 2 }], ["appA", "app-service", 340, 160, { pods: 16 }], ["appB", "app-service", 960, 160, { pods: 16 }], ["db", "replicated-db", 560, 340, { replicas: 2, replicaPlacement: "same-region" }]],
      edges: [["users", "out", "lb", "in"], ["lb", "out", "appA", "in"], ["lb", "out", "appB", "in"], ["appA", "db", "db", "in"], ["appB", "db", "db", "in"]],
    },
    "async-and-lossy": {
      nodes: [["lb", "load-balancer", 120, 260, { algorithm: "failover", checkIntervalSec: 2, unhealthyThreshold: 2 }], ["appA", "app-service", 340, 160, { pods: 16 }], ["appB", "app-service", 960, 160, { pods: 16 }], ["db", "replicated-db", 560, 340, { replicas: 2, replicaPlacement: "other-region", replication: "async", shipLagSec: 4 }]],
      edges: [["users", "out", "lb", "in"], ["lb", "out", "appA", "in"], ["lb", "out", "appB", "in"], ["appA", "db", "db", "in"], ["appB", "db", "db", "in"]],
    },
  },
};
