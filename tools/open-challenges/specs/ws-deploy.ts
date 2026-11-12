import { sc, users, type Spec } from "../kit";

const deploy = (at = 420) => [{ id: "deploy", kind: "deploy-restart", target: "kind:websocket", atSec: at }];
const T = { type: "constant" as const, rps: 8000 };

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "a-million-sockets-and-a-deploy", title: "A million open connections and a deploy", category: "Scalability", level: "senior", estimatedMinutes: 30,
    tags: ["persistent connections", "reconnect storm", "capacity planning", "jitter"],
    summary: "Real-time chat reaches a million concurrent connections. Then a deploy drops all of them at once.",
    statement: {
      situation: "A real-time messaging product keeps one long-lived connection per active user. New connections arrive at about 8,000 per second and last around two minutes, so the fleet settles at close to a million simultaneous connections. Each gateway machine has a fixed amount of memory and can only complete so many new TLS handshakes per second. Every release restarts the gateways and drops every connection at once.",
      symptoms: ["During a deploy the gateways report a surge of connection attempts many times their normal rate", "Handshake capacity is saturated; most attempts fail and clients retry immediately", "It takes minutes for the fleet to settle, and some gateways run out of memory"],
      requirements: ["Hold roughly a million connections with memory headroom (under 90% full)", "A deploy must not cause a reconnect storm (no more than 5,000 refused connection attempts per second)", "Stay within budget"],
      constraints: ["Budget: $5.00/hour", "Gateway machine size, memory per connection and handshake rate are fixed", "You can change how many gateways run and how clients behave when disconnected"],
    },
    learningObjectives: ["Connection capacity from memory and per-node limits", "Accept-rate limits and reconnect storms", "Jitter as load shaping", "Sizing for failure and deploys, not just steady state"],
    references: [{ title: "Phoenix: the road to 2 million websocket connections", url: "https://www.phoenixframework.org/blog/the-road-to-2-million-websocket-connections" }],
    resources: {
      allowed: ["websocket", "load-balancer", "api-gateway"],
      budget: { maxCostPerHour: 5 },
      fixed: [users({ readRatio: 1, share: 100 }, 0, 220)],
      kindDefaults: { websocket: { maxConnsPerNode: 60000, memoryPerConnKB: 20, memoryGiB: 4, acceptPerSecPerNode: 1500, sessionSec: 120, costPerNodeHour: 0.2, heartbeatSec: 30 } },
      kindLocked: { websocket: ["maxConnsPerNode", "memoryPerConnKB", "memoryGiB", "acceptPerSecPerNode", "sessionSec", "costPerNodeHour"] },
    },
    scenarios: [{ id: "deploy", name: "Steady state, then a deploy at t=420 s", description: "8,000 new connections/s. At t=420 s every gateway restarts and all connections drop.", scenario: sc("Deploy drops everyone", T, 640, deploy(), { tickMs: 50 }) }],
    successCriteria: [{ id: "capacity", label: "Memory under 90% before the deploy" }, { id: "storm", label: "Refused connection attempts stay ≤ 5,000/s through the deploy" }, { id: "cost", label: "Within budget" }],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [{ id: "deploy-late", name: "Higher arrival rate (9,000/s), later deploy", scenario: sc("Deploy, higher load", { type: "constant", rps: 9000 }, 700, deploy(480), { tickMs: 50, seed: 5 }) }],
    criteria: [
      { id: "memory", label: "Memory ≤ 90% before the deploy", hard: true, weight: 3, scenario: "all", metric: "websocket.memory", agg: "max", before: 400, op: "<=", value: 0.9, limit: 1.5 },
      { id: "storm", label: "Refused attempts ≤ 5,000/s", hard: true, weight: 4, scenario: "all", metric: "websocket.rejected", agg: "max", after: 120, op: "<=", value: 5000, limit: 200000 },
      { id: "avail", label: "Availability ≥ 97%", weight: 3, scenario: "all", metric: "e2e.availability", agg: "mean", after: 120, op: ">=", value: 0.97, limit: 0.5 },
    ],
  },
  writeup: `
Steady state is a memory problem: connections × memory per connection must fit with headroom, so the fleet size follows directly from per-node memory. The deploy is a different problem. When every connection drops at once, a million clients try to reconnect immediately; handshake capacity is a few thousand per second per node, so most attempts are refused and the clients retry, keeping the fleet saturated for as long as the herd lasts.

Two levers help. Handshake capacity scales with nodes, but sizing for the herd directly (a million connections in seconds) is far more than sizing for steady state. Jitter — clients waiting a random time before reconnecting — spreads the same million reconnects over a minute or two so arrivals stay within capacity. It costs nothing and is the standard answer; the capacity you already need for steady state is then enough, as long as it carries headroom for the reconnect rate.
`,
  reference: {
    nodes: [["ws", "websocket", 400, 220, { nodes: 20, reconnectJitterSec: 90 }]],
    edges: [["users", "out", "ws", "in"]],
  },
  alternatives: {
    "more-nodes-shorter-jitter": { nodes: [["ws", "websocket", 400, 220, { nodes: 24, reconnectJitterSec: 80 }]], edges: [["users", "out", "ws", "in"]] },
  },
  attempts: {
    "no-jitter": { nodes: [["ws", "websocket", 400, 220, { nodes: 20, reconnectJitterSec: 0 }]], edges: [["users", "out", "ws", "in"]] },
    "too-small": { nodes: [["ws", "websocket", 400, 220, { nodes: 10, reconnectJitterSec: 90 }]], edges: [["users", "out", "ws", "in"]] },
  },
};
