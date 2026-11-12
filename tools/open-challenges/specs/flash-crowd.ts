import { flat, sc, users, type Spec } from "../kit";

const client = { readRatio: 0.85, retries: 2, backoffMs: 200, backoffMultiplier: 2, jitter: 0.5, retryBudgetPct: 100 };
const surge = { type: "step" as const, baseRps: 600, stepRps: 9000, atSec: 30 };
void flat;

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "flash-crowd", title: "The promotion nobody warned you about", category: "Scalability", level: "advanced", estimatedMinutes: 35,
    tags: ["autoscaling", "traffic spike", "cascading failure", "cost"],
    summary: "Traffic goes from 600 to 9,000 req/s in one step, and your instances take a minute to start.",
    statement: {
      situation: "Marketing sent a push notification to every user without telling engineering. Normal traffic is around 600 requests/s; within seconds it jumps to 9,000 and stays there for several minutes. Your service has autoscaling, but new instances take about a minute to become useful, and the mobile client retries failed requests twice.",
      symptoms: ["Latency climbs, then requests time out", "Retries pile more load on top of the spike", "The database runs out of connections while servers are still starting"],
      requirements: ["Keep the product working through the surge — most requests must succeed", "No cascading failure: the system must not collapse and stay down after the spike", "Retries must not multiply the load beyond control"],
      constraints: ["Budget: $3.00/hour for everything", "You cannot change the client's retry behaviour", "You cannot pre-warm for a spike you weren't told about (assume nothing changes before it starts)"],
    },
    learningObjectives: ["Scaling delay versus spike speed", "Offloading work instead of only adding capacity", "Load shedding and retry amplification", "Cost-aware capacity decisions"],
    references: [{ title: "Google SRE book: Addressing cascading failures", url: "https://sre.google/sre-book/addressing-cascading-failures/" }, { title: "AWS Builders' Library: Using load shedding to avoid overload", url: "https://builder.aws.com/content/3Eun1EEyX6p2e3VYNyRLSJzLuMV/using-load-shedding-to-avoid-overload" }, { title: "Kubernetes: Horizontal Pod Autoscaling", url: "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/" }],
    resources: {
      allowed: ["load-balancer", "api-gateway", "app-service", "cdn", "redis", "rate-limiter", "replicated-db"],
      budget: { maxCostPerHour: 3 },
      fixed: [users(client)],
      kindDefaults: { "app-service": { cpuMsPerReq: 5, vcpuPerPod: 2, startupSec: 60, queueLimit: 400 }, "replicated-db": { readQps: 6000, writeQps: 1500, maxConnections: 300, costPerNodeHour: 0.35 }, cdn: { hitRatio: 0.9 } },
      kindLocked: { "app-service": ["cpuMsPerReq", "vcpuPerPod", "startupSec"], "replicated-db": ["readQps", "writeQps", "costPerNodeHour"], cdn: ["hitRatio"] },
    },
    scenarios: [{ id: "promo", name: "Push-notification spike", description: "600 → 9,000 req/s at t=30 s, held for 4 minutes. Requests that take over 1.5 s count as failed.", scenario: sc("Promotion spike", surge, 270, [], { timeoutMs: 1500 }) }],
    successCriteria: [
      { id: "avail", label: "Most requests succeed once the spike is underway (≥ 85%)" }, { id: "recover", label: "Steady state restored soon after capacity arrives" },
      { id: "retry", label: "Retry traffic stays under control" }, { id: "latency", label: "Served requests are fast (p99 ≤ 1.2 s)" }, { id: "cost", label: "Within budget" },
    ],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [
      { id: "ramp", name: "Faster, bigger spike (11,000 req/s)", scenario: sc("Bigger spike", { type: "step", baseRps: 700, stepRps: 11000, atSec: 25 }, 270, [], { timeoutMs: 1500, seed: 9 }) },
      { id: "double", name: "Spike, brief lull, second spike", scenario: sc("Double spike", { type: "spike", baseRps: 600, spikeRps: 9000, atSec: 30, widthSec: 80 }, 300, [], { timeoutMs: 1500, seed: 11 }) },
    ],
    criteria: [
      { id: "avail", label: "Availability ≥ 85% during the spike", hard: true, weight: 4, scenario: "all", metric: "e2e.availability", agg: "mean", after: 40, op: ">=", value: 0.85, limit: 0.4 },
      { id: "recover", label: "Healthy again (≥ 97%) within 120 s of the spike", hard: true, weight: 3, scenario: "promo", metric: "e2e.availability", agg: "settleSec", after: 30, settle: 0.97, op: "<=", value: 120, limit: 240 },
      { id: "retry", label: "Retry traffic ≤ 1× offered load", weight: 2, scenario: "all", metric: "e2e.retryRatio", agg: "max", op: "<=", value: 1, limit: 2 },
      { id: "latency", label: "p99 ≤ 1.2 s after warm-up", weight: 2, scenario: "all", metric: "e2e.p99", agg: "mean", after: 90, before: 250, op: "<=", value: 1200, limit: 3000 },
    ],
  },
  writeup: `
Autoscaling cannot be the whole answer when the spike arrives in a single step: new instances take a minute, so the first minute has to be survived by something else. There are two honest strategies. Offload — a CDN or cache absorbs the cacheable majority of reads so origin capacity needed drops by an order of magnitude — and protect — a gateway that sheds work by queue age keeps the servers inside their capacity instead of letting a deep queue turn every request into a timeout and every timeout into two more requests.

Buying your way out (pre-provisioning for 9,000 req/s) is exactly what the budget rules out here, and it wouldn't help if the next spike were bigger. Autoscaling on queue wait reacts to backlog sooner than CPU does, but still arrives late; it is the follow-up, not the first line of defence.

Multiple designs pass: CDN + gateway + autoscaled app tier, cache + gateway, or heavy shedding with fewer servers if you accept lower availability. They differ in cost and in how much of the surge is served rather than rejected.
`,
  reference: {
    nodes: [
      ["cdn", "cdn", 220, 220, { warmupSec: 10 }],
      ["gw", "api-gateway", 440, 220, { capacityRps: 30000, shedding: true, maxQueueAgeMs: 150, breaker: false }],
      ["app", "app-service", 660, 220, { pods: 8, hpa: true, hpaMetric: "queue", hpaTarget: 0.1, hpaCooldownSec: 5, maxStepPods: 20, maxPods: 40, queueLimit: 400 }],
      ["db", "replicated-db", 880, 220, { replicas: 1, readRouting: "replicas", maxConnections: 500 }],
    ],
    edges: [["users", "out", "cdn", "in"], ["cdn", "origin", "gw", "in"], ["gw", "out", "app", "in"], ["app", "db", "db", "in"]],
  },
  alternatives: {
    "cdn-only": {
      nodes: [["cdn", "cdn", 240, 220, { warmupSec: 10 }], ["app", "app-service", 480, 220, { pods: 10, hpa: true, hpaMetric: "queue", hpaTarget: 0.1, hpaCooldownSec: 5, maxStepPods: 20, maxPods: 25 }], ["db", "replicated-db", 720, 220, { replicas: 1 }]],
      edges: [["users", "out", "cdn", "in"], ["cdn", "origin", "app", "in"], ["app", "db", "db", "in"]],
    },
  },
  attempts: {
    "autoscale-only": {
      nodes: [["app", "app-service", 300, 220, { pods: 4, hpa: true, hpaMetric: "cpu", hpaTarget: 0.6, hpaCooldownSec: 30, maxStepPods: 4, maxPods: 40 }], ["db", "replicated-db", 600, 220, { replicas: 1 }]],
      edges: [["users", "out", "app", "in"], ["app", "db", "db", "in"]],
    },
    "overprovision": {
      nodes: [["app", "app-service", 300, 220, { pods: 26, hpa: false }], ["db", "replicated-db", 600, 220, { replicas: 2 }]],
      edges: [["users", "out", "app", "in"], ["app", "db", "db", "in"]],
    },
  },
};
