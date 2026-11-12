import { sc, users, type Spec } from "../kit";

const release = (at: number, errPct: number, latencyX = 1) => [{ id: "rel", kind: "release", target: "kind:app-service", atSec: at, params: { errPct, latencyX } }];

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "release-that-looked-fine", title: "The release that passed every check", category: "Deployment and Release Engineering", level: "advanced", estimatedMinutes: 30,
    tags: ["canary", "rollback", "blue-green", "blast radius", "release engineering"],
    summary: "A new version shipped. Health checks are green. A quarter of requests are failing.",
    statement: {
      situation: "Your service handles 3,000 requests/s. A new release goes out at 1 minute in. Its health checks pass, but it quietly returns errors on a quarter of the requests it serves. Nobody notices until customers complain — unless your deployment process notices first.",
      symptoms: ["Errors rise gradually as the rollout proceeds", "Every instance reports healthy", "By the time someone investigates, the whole fleet runs the bad version"],
      requirements: ["Limit how many users ever see the bad version", "Detect and undo the release automatically", "Don't lose capacity (or money) just to deploy safely"],
      constraints: ["Budget: $3.00/hour at peak (including extra capacity during a rollout)", "New instances take 30 s to start", "You can't make the new version better — only control how it's released"],
    },
    learningObjectives: ["Blast radius and exposure over time", "Why health checks don't catch correctness regressions", "Strategy trade-offs: rolling, canary, blue-green", "Rollback speed and capacity during a rollback"],
    references: [{ title: "Kubernetes: Deployments (rolling update)", url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/" }, { title: "Kubernetes: liveness, readiness and startup probes", url: "https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/" }],
    resources: {
      allowed: ["app-service", "load-balancer", "api-gateway"],
      budget: { maxCostPerHour: 3 },
      fixed: [users({ readRatio: 1 })],
      kindDefaults: { "app-service": { cpuMsPerReq: 10, vcpuPerPod: 2, startupSec: 30, costPerPodHour: 0.09 } },
      kindLocked: { "app-service": ["cpuMsPerReq", "vcpuPerPod", "startupSec", "costPerPodHour"] },
    },
    scenarios: [{ id: "bad", name: "Release with 25% errors at t=60 s", description: "3,000 req/s for 8 minutes. At t=60 s a release is rolled out. The new version fails 25% of the requests it handles.", scenario: sc("Bad release", { type: "constant", rps: 3000 }, 480, release(60, 25)) }],
    successCriteria: [
      { id: "blast", label: "Total error volume stays small (≤ 1.5% of all requests)" }, { id: "recover", label: "Fully healthy again within 3 minutes of the release" }, { id: "capacity", label: "Capacity never dips enough to cause its own errors" }, { id: "cost", label: "Within budget" },
    ],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [
      { id: "harder", name: "Release with 40% errors at higher load", scenario: sc("Bad release, higher load", { type: "constant", rps: 3400 }, 480, release(90, 40), { seed: 3 }) },
      { id: "good", name: "A good release (no defects)", scenario: sc("Good release", { type: "constant", rps: 3000 }, 480, release(60, 0), { seed: 2 }) },
    ],
    criteria: [
      { id: "blast", label: "Errors ≤ 1.5% of all requests", hard: true, weight: 4, scenario: "all", metric: "e2e.errorRate", agg: "mean", op: "<=", value: 0.015, limit: 0.1 },
      { id: "recover", label: "Healthy within 180 s of the release", hard: true, weight: 3, scenario: "bad", metric: "e2e.availability", agg: "settleSec", after: 60, settle: 0.99, op: "<=", value: 180, limit: 400 },
      { id: "capacity", label: "A good release doesn't cost availability", hard: true, weight: 3, scenario: "good", metric: "e2e.errorRate", agg: "max", op: "<=", value: 0.01, limit: 0.2 },
    ],
  },
  writeup: `
Health checks verify that an instance is alive and ready, not that it is correct, so a version that returns errors passes them. What actually limits damage is how much traffic the new version sees before you learn it is bad, and how fast you can stop. A rolling update replaces the fleet quickly, so exposure grows with every batch; if nothing watches the error rate the bad version simply finishes the rollout.

A canary sends a small share of traffic to the new version first and holds, so a bad release is seen by a few percent of users for the hold time plus the detection time, and rolling back is cheap because most of the fleet is untouched. Blue-green gives instant rollback and no mixed fleet, but flips all traffic at once (full exposure until detected) and doubles capacity during the rollout — usually the most expensive option.

The common thread is automatic rollback on an error-rate signal. Without it, every strategy ends at 100% bad.
`,
  reference: {
    nodes: [["app", "app-service", 300, 220, { pods: 18, hpa: false, strategy: "canary", canaryPct: 10, canaryHoldSec: 30, autoRollback: true, rollbackErrorPct: 5, detectSec: 15, maxSurgePct: 25, gracefulSec: 20 }]],
    edges: [["users", "out", "app", "in"]],
  },
  alternatives: {
    "rolling-with-rollback": {
      nodes: [["app", "app-service", 300, 220, { pods: 18, hpa: false, strategy: "rolling", maxSurgePct: 10, autoRollback: true, rollbackErrorPct: 5, detectSec: 10, gracefulSec: 20 }]],
      edges: [["users", "out", "app", "in"]],
    },
  },
  attempts: {
    "rolling-no-rollback": { nodes: [["app", "app-service", 300, 220, { pods: 18, hpa: false, strategy: "rolling", autoRollback: false }]], edges: [["users", "out", "app", "in"]] },
    "blue-green-expensive": { nodes: [["app", "app-service", 300, 220, { pods: 18, hpa: false, strategy: "bluegreen", autoRollback: true, detectSec: 15 }]], edges: [["users", "out", "app", "in"]] },
    "canary-no-rollback": { nodes: [["app", "app-service", 300, 220, { pods: 18, hpa: false, strategy: "canary", canaryPct: 10, canaryHoldSec: 30, autoRollback: false }]], edges: [["users", "out", "app", "in"]] },
  },
};
