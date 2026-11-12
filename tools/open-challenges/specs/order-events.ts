import { sc, users, type Spec } from "../kit";

const ledger = { id: "ledger", kind: "ec2", label: "Ledger service", x: 960, y: 220, locked: true as const, config: { count: 4, vcpu: 4, burstable: false, cpuCostMs: 2, networkMbps: 25000, queueLimit: 200, costPerHourEach: 0.1, creditsPerHour: 0, initialCredits: 0 } };
const faults = (outageAt = 100, outageLen = 20) => [
  { id: "rebal", kind: "rebalance", target: "kind:kafka", atSec: 60 },
  { id: "ledger-down", kind: "kill-node", target: "ledger", atSec: outageAt, untilSec: outageAt + outageLen },
];
const T = { type: "constant" as const, rps: 6000 };

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "orders-fall-behind", title: "Orders are piling up, and some are charged twice", category: "Messaging and Event Processing", level: "senior", estimatedMinutes: 35,
    tags: ["backlog", "duplicates", "idempotency", "at-least-once", "backpressure"],
    summary: "The ledger can't always keep up, and your retries are double-charging customers.",
    statement: {
      situation: "Every order produces an event; the fleet emits about 6,000 events/s. A ledger service must record each one exactly once — charging a customer twice is a finance incident. The ledger can handle roughly 8,000 events/s but it occasionally stops for a short time (deploys, failovers), and the consuming side occasionally pauses and restarts for rebalancing.",
      symptoms: ["Events are lost while the ledger is down", "After the ledger recovers, the backlog takes a long time to drain", "Finance finds some orders recorded twice after consumer restarts"],
      requirements: ["No event may be lost", "No customer may be charged twice (duplicates at the ledger ≤ 0.1%)", "After a ledger outage the backlog must clear within two minutes"],
      constraints: ["Budget: $2.00/hour including the ledger", "The ledger service is fixed — you can't change or scale it", "Processing a message costs a fixed amount of time per consumer"],
    },
    learningObjectives: ["At-least-once delivery and where duplicates come from", "Idempotent consumers vs commit strategy", "Headroom: capacity needed to drain a backlog", "Buffering versus losing work during downstream outages"],
    references: [{ title: "Confluent: Exactly-once semantics in Apache Kafka", url: "https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/" }, { title: "RabbitMQ: consumer acknowledgements and publisher confirms", url: "https://www.rabbitmq.com/docs/confirms" }, { title: "Uber: reliable reprocessing and dead letter queues with Kafka", url: "https://www.uber.com/blog/reliable-reprocessing/" }, { title: "Stripe: designing robust APIs with idempotency", url: "https://stripe.com/blog/idempotency" }],
    resources: {
      allowed: ["kafka", "rabbitmq", "idempotency-store", "app-service", "load-balancer", "api-gateway"],
      budget: { maxCostPerHour: 2 },
      fixed: [users({ readRatio: 0 }), ledger],
      kindDefaults: { kafka: { consumerRate: 2000, partitionRate: 10000 }, rabbitmq: { consumerRate: 2000 } },
      kindLocked: { kafka: ["consumerRate", "partitionRate", "costBaseHour", "costPerConsumerHour"], rabbitmq: ["consumerRate", "costBaseHour", "costPerConsumerHour"] },
    },
    scenarios: [{ id: "outage", name: "Ledger stops for 20 s; consumers rebalance once", description: "6,000 events/s for 5 minutes. A consumer rebalance at t=60 s; the ledger is down from t=100 s to t=120 s.", scenario: sc("Ledger outage", T, 300, faults(), { tickMs: 20 }) }],
    successCriteria: [
      { id: "loss", label: "No events lost (errors ≤ 0.2%)" }, { id: "dup", label: "Duplicates at the ledger ≤ 0.1%" }, { id: "drain", label: "Delay back under 8 s within 2 minutes of the ledger returning" }, { id: "cost", label: "Within budget" },
    ],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [{ id: "longer", name: "Longer outage (40 s) and a second rebalance", scenario: sc("Longer outage", T, 360, [...faults(120, 40), { id: "rebal2", kind: "rebalance", target: "kind:kafka", atSec: 200 }], { tickMs: 20, seed: 8 }) }],
    criteria: [
      { id: "loss", label: "Event loss ≤ 0.2%", hard: true, weight: 4, scenario: "all", metric: "e2e.errorRate", agg: "mean", op: "<=", value: 0.002, limit: 0.05 },
      { id: "dup", label: "Duplicates ≤ 0.1%", hard: true, weight: 4, scenario: "all", metric: "e2e.duplicateRate", agg: "mean", op: "<=", value: 0.001, limit: 0.02 },
      { id: "drain", label: "p95 delay back under 8 s within 120 s of recovery", hard: true, weight: 3, scenario: "outage", metric: "e2e.p95", agg: "settleSec", after: 120, settle: 8000, settleWhen: "below", op: "<=", value: 120, limit: 300 },
      { id: "drain-long", label: "Backlog cleared after the longer outage", weight: 2, scenario: "longer", metric: "e2e.p95", agg: "settleSec", after: 160, settle: 8000, settleWhen: "below", op: "<=", value: 120, limit: 300 },
    ],
  },
  writeup: `
Three separate things go wrong at once. The ledger outage loses events unless something buffers them — a log or queue between producers and the ledger turns an outage into lag. The lag then only clears if consumers have headroom: with capacity equal to the arrival rate a backlog never drains, so you need meaningfully more processing capacity than input.

Duplicates come from at-least-once delivery. After a rebalance an auto-committing consumer replays everything since its last commit, which is seconds of traffic. You can shrink that window (commit after processing, so only the in-flight batch is replayed) or make the ledger path idempotent with a store of recent keys that absorbs replays. The first is cheaper; the second is robust to every source of duplicates, including ones you didn't think of, but its retention window must be longer than the longest redelivery delay.

Either route works; message brokers differ in what they replay, which is why the guard that sits next to the ledger is the one that holds under every failure.
`,
  reference: {
    nodes: [["k", "kafka", 400, 220, { partitions: 12, consumers: 6, commitMode: "manual", retryOnFailure: true }]],
    edges: [["users", "out", "k", "produce"], ["k", "consume", "ledger", "in"]],
  },
  alternatives: {
    "autocommit-plus-dedup": {
      nodes: [["k", "kafka", 300, 220, { partitions: 12, consumers: 6, commitMode: "auto", commitIntervalSec: 5 }], ["idem", "idempotency-store", 620, 220, { windowSec: 900, dupDelaySec: 30 }]],
      edges: [["users", "out", "k", "produce"], ["k", "consume", "idem", "in"], ["idem", "out", "ledger", "in"]],
    },
  },
  attempts: {
    "direct": { nodes: [], edges: [["users", "out", "ledger", "in"]] },
    "no-headroom": { nodes: [["k", "kafka", 400, 220, { partitions: 6, consumers: 3, commitMode: "manual" }]], edges: [["users", "out", "k", "produce"], ["k", "consume", "ledger", "in"]] },
    "autocommit-no-guard": { nodes: [["k", "kafka", 400, 220, { partitions: 12, consumers: 6, commitMode: "auto", commitIntervalSec: 5 }]], edges: [["users", "out", "k", "produce"], ["k", "consume", "ledger", "in"]] },
  },
};
