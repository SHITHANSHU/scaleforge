import { sc, users, type Spec } from "../kit";

const client = { readRatio: 1, retries: 3, backoffMs: 100, backoffMultiplier: 1, jitter: 0, retryBudgetPct: 100 };
const spike = (peak: number, at = 20, width = 10) => ({ type: "spike" as const, baseRps: 700, spikeRps: peak, atSec: at, widthSec: width });

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "everyone-retries", title: "Ten seconds of trouble, ten minutes of outage", category: "Fault Tolerance", level: "staff", estimatedMinutes: 40,
    tags: ["retry storm", "metastable failure", "load shedding", "overload"],
    summary: "A short blip is over, but the system never recovers.",
    statement: {
      situation: "An internal API handles about 700 requests/s with comfortable headroom. For ten seconds a burst of extra traffic pushes it past its limit. The burst ends, yet the service stays overloaded and keeps failing for minutes. The clients — hundreds of third-party integrations you don't control — retry failed or slow calls up to three times, 100 ms apart, and time out after half a second.",
      symptoms: ["Error rate stays high long after the trigger ended", "Latency is enormous for requests that do succeed", "Total attempts are several times the real demand"],
      requirements: ["The service must return to normal on its own shortly after the burst", "Retries must not be able to sustain the overload", "Don't turn away traffic that fits within capacity"],
      constraints: ["Budget: $1.00/hour", "Clients can't be changed", "The application's server accepts connections into a very deep backlog (you can't shrink it)"],
    },
    learningObjectives: ["Metastable failures: a trigger that outlives itself", "Stale work and timeouts", "Bounding queues by age, not size", "Why capacity alone doesn't fix retry amplification"],
    references: [{ title: "Google SRE book: Addressing cascading failures", url: "https://sre.google/sre-book/addressing-cascading-failures/" }, { title: "Google SRE book: Handling overload", url: "https://sre.google/sre-book/handling-overload/" }, { title: "AWS Builders' Library: Timeouts, retries and backoff with jitter", url: "https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/" }],
    resources: {
      allowed: ["load-balancer", "api-gateway", "app-service", "rate-limiter"],
      budget: { maxCostPerHour: 1 },
      fixed: [users(client)],
      kindDefaults: { "app-service": { cpuMsPerReq: 10, vcpuPerPod: 2, startupSec: 30, queueLimit: 20000, pods: 4, hpa: false } },
      kindLocked: { "app-service": ["cpuMsPerReq", "vcpuPerPod", "startupSec", "queueLimit"] },
    },
    scenarios: [{ id: "blip", name: "A 10-second burst", description: "Normal 700 req/s. For 10 s at t=20 the load rises to 1,600 req/s. Clients time out after 500 ms.", scenario: sc("Burst", spike(1600), 150, [], { timeoutMs: 500 }) }],
    successCriteria: [
      { id: "recover", label: "Back to ≥ 98% success within 40 s of the burst ending" }, { id: "retry", label: "Retries never exceed 1.5× offered load" }, { id: "steady", label: "Normal traffic is served normally afterwards (p99 ≤ 300 ms)" }, { id: "cost", label: "Within budget" },
    ],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [
      { id: "bigger", name: "A bigger burst (2,200 req/s for 15 s)", scenario: sc("Bigger burst", spike(2200, 20, 15), 160, [], { timeoutMs: 500, seed: 4 }) },
      { id: "twice", name: "Two bursts, 40 s apart", scenario: sc("Two bursts", { type: "pulses", baseRps: 700, peakRps: 1600, firstAtSec: 20, widthSec: 10, everySec: 60, count: 2 }, 170, [], { timeoutMs: 500, seed: 6 }) },
    ],
    criteria: [
      { id: "recover", label: "Settles ≥ 98% within 40 s of the burst", hard: true, weight: 4, scenario: "blip", metric: "e2e.availability", agg: "settleSec", after: 30, settle: 0.98, op: "<=", value: 40, limit: 120 },
      { id: "recover-big", label: "Settles within 40 s of the bigger burst", hard: true, weight: 2, scenario: "bigger", metric: "e2e.availability", agg: "settleSec", after: 35, settle: 0.98, op: "<=", value: 40, limit: 120 },
      { id: "recover-twice", label: "Settles within 40 s of the second burst", hard: true, weight: 2, scenario: "twice", metric: "e2e.availability", agg: "settleSec", after: 90, settle: 0.98, op: "<=", value: 40, limit: 120 },
      { id: "retry", label: "Retries ≤ 1.5× offered", weight: 2, scenario: "all", metric: "e2e.retryRatio", agg: "max", op: "<=", value: 1.5, limit: 4 },
      { id: "steady", label: "p99 ≤ 300 ms in steady state", weight: 2, scenario: "all", metric: "e2e.p99", agg: "mean", after: 100, op: "<=", value: 300, limit: 2000 },
    ],
  },
  writeup: `
The burst is not the incident; the backlog is. The application accepts requests into a very deep queue, so during the burst it fills with work that will already have timed out by the time it is served. Serving that stale work burns capacity on responses nobody is waiting for, the clients retry, the retries join the queue behind the stale work, and the system stays saturated long after the trigger is gone.

More servers help only if you can afford enough to absorb the burst plus retries. The reliable fix is to bound the queue by age rather than size, so requests that would wait longer than the clients' patience are rejected immediately (the clients retry, but at least the retry meets an empty queue). A gateway with load shedding in front of the application does exactly that, and it costs far less than doubling the fleet. Adding a circuit breaker on top stops retries from hammering a struggling backend.
`,
  reference: {
    nodes: [["gw", "api-gateway", 240, 220, { capacityRps: 1000, shedding: true, maxQueueAgeMs: 100, breaker: false }], ["app", "app-service", 480, 220, { pods: 5, hpa: false }]],
    edges: [["users", "out", "gw", "in"], ["gw", "out", "app", "in"]],
  },
  alternatives: {
    "rate-limit-front": {
      nodes: [["rl", "rate-limiter", 240, 220, { algorithm: "sliding-window", limitRps: 900, burst: 100 }], ["gw", "api-gateway", 440, 220, { capacityRps: 1000, shedding: true, maxQueueAgeMs: 150, breaker: false }], ["app", "app-service", 680, 220, { pods: 5, hpa: false }]],
      edges: [["users", "out", "rl", "in"], ["rl", "out", "gw", "in"], ["gw", "out", "app", "in"]],
    },
  },
  attempts: {
    "direct": { nodes: [["app", "app-service", 300, 220, { pods: 5, hpa: false }]], edges: [["users", "out", "app", "in"]] },
    "gateway-no-shedding": { nodes: [["gw", "api-gateway", 240, 220, { capacityRps: 1000, shedding: false, queueLimit: 100000, breaker: false }], ["app", "app-service", 480, 220, { pods: 5, hpa: false }]], edges: [["users", "out", "gw", "in"], ["gw", "out", "app", "in"]] },
  },
};
