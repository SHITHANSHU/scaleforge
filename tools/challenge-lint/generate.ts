// Authoring helper: builds challenge folders from compact specs using the live component defaults.
// Run: pnpm tsx tools/challenge-lint/generate.ts   (contributors may also hand-write the JSON.)
import { mkdirSync, writeFileSync } from "node:fs";
import { createDefaultRegistry, type Challenge, type Scenario } from "../../packages/engine/index";

const reg = createDefaultRegistry();
type Cfg = Record<string, number | string | boolean>;
type N = [id: string, kind: string, x: number, y: number, cfg?: Cfg, label?: string];
type E = [from: string, fromPort: string, to: string, toPort: string];

function design(name: string, nodes: N[], edges: E[], scenario: Scenario) {
  const ns = nodes.map(([id, kind, x, y, cfg, label]) => ({ id, kind, x, y, label, config: { ...reg.get(kind)!.defaults, ...cfg } }));
  const es = edges.map(([from, fromPort, to, toPort], i) => {
    const a = reg.get(ns.find((n) => n.id === from)!.kind)!, b = reg.get(ns.find((n) => n.id === to)!.kind)!;
    const protocol = a.ports.find((p) => p.id === fromPort)!.protocols.find((p) => b.ports.find((q) => q.id === toPort)!.protocols.includes(p))!;
    return { id: `e${i + 1}`, from, fromPort, to, toPort, protocol, latencyMs: 1 };
  });
  return { schemaVersion: 1, id: `starter-${name}`, name, nodes: ns, edges: es, scenario, updatedAt: 0 };
}
const sc = (name: string, rps: number, durationSec: number, extra: Partial<Scenario> = {}): Scenario => ({ name, durationSec, seed: 42, traffic: { type: "constant", rps }, faults: [], ...extra });

interface Spec { meta: Omit<Challenge, "scenario">; scenario: Scenario; brief: string; starter: [N[], E[]]; solution: [N[], E[]]; writeup: string }
const client = (cfg: Cfg = {}): N => ["c", "client", 0, 120, cfg];
const bigApp = (cfg: Cfg = {}): N => ["app", "ec2", 260, 120, { count: 8, vcpu: 2, burstable: false, creditsPerHour: 0, initialCredits: 0, networkMbps: 750, cpuCostMs: 3, ...cfg }, "API"];

const specs: Spec[] = [
  {
    meta: { id: "cache-aside-01", title: "Cache-aside for a read-heavy API", level: "mid", tags: ["redis", "cache", "database"], summary: "The database can't keep up with 4,000 reads/s.", locked: ["db"], criteria: [
      { metric: "e2e.errorRate", op: "<", value: 0.01, after: 45, label: "Errors under 1%" }, { metric: "postgres.utilization", op: "<", value: 0.8, after: 45, label: "DB below 80% utilization" }], hints: ["Which tier is saturating first? Check Bottlenecks.", "Reads can be answered from memory. Where does a cache go?", "Does the working set fit in the cache's memory?"] },
    scenario: sc("4k rps, 95% reads", 4000, 90),
    brief: "# Cache-aside for a read-heavy API\n\nA catalog API serves **4,000 requests/s, 95% reads** straight from a small Postgres. The database is saturated and requests are failing.\n\nAdd a cache so the database stays under 80% utilization with errors under 1%. The database is locked: you can't just buy a bigger one.\n\n**Concepts:** hit ratio, TTL, DB offload.",
    starter: [[client({ readRatio: 0.95 }), bigApp(), ["db", "postgres", 520, 120, { readQps: 1500, writeQps: 600 }]], [["c", "out", "app", "in"], ["app", "out", "db", "in"]]],
    solution: [[client({ readRatio: 0.95 }), bigApp(), ["r", "redis", 520, 120, { memoryMB: 512, keyspace: 50000, avgItemKB: 1, ttlSec: 300, zipfSkew: 1 }], ["db", "postgres", 780, 120, { readQps: 1500, writeQps: 600 }]], [["c", "out", "app", "in"], ["app", "out", "r", "in"], ["r", "miss", "db", "in"]]],
    writeup: "Put Redis between the app and Postgres. With a Zipf-skewed catalog, a cache that holds the hot set answers most reads, so the DB only sees misses and writes. Trade-off: staleness up to the TTL and an extra tier to run.",
  },
  {
    meta: { id: "bloom-username-01", title: "Bloom filter for username availability", level: "mid", tags: ["bloom-filter", "database"], summary: "Most lookups are for unused names, yet all hit the DB.", locked: ["db"], criteria: [
      { metric: "postgres.utilization", op: "<", value: 0.5, after: 20, label: "DB below 50% utilization" }, { metric: "bloom-filter.fpObserved", op: "<", value: 0.03, after: 20, label: "Observed false positives under 3%" }], hints: ["The filter was sized for far fewer names than it holds.", "What happens to the false-positive rate when you insert more than n items?"] },
    scenario: sc("Signup checks", 3000, 40),
    brief: "# Bloom filter for username availability\n\nSignup form checks hit Postgres for every keystroke. **85% of names checked are free.** A Bloom filter is in front of the DB, but it was sized for 100k names and now holds 400k — false positives flood the DB.\n\nResize the filter so the DB stays under 50% utilization and observed false positives stay under 3%.\n\n**Concepts:** sizing n and p, overfill, FP cost on the DB.",
    starter: [[client({ readRatio: 1 }), ["b", "bloom-filter", 260, 120, { expectedItems: 100000, fpTarget: 0.01, loadedItems: 400000, existsRatio: 0.15 }], ["db", "postgres", 520, 120, { readQps: 4000 }]], [["c", "out", "b", "in"], ["b", "maybe", "db", "in"]]],
    solution: [[client({ readRatio: 1 }), ["b", "bloom-filter", 260, 120, { expectedItems: 500000, fpTarget: 0.01, loadedItems: 400000, existsRatio: 0.15 }], ["db", "postgres", 520, 120, { readQps: 4000 }]], [["c", "out", "b", "in"], ["b", "maybe", "db", "in"]]],
    writeup: "Set n above the real item count (with headroom) so the bit array is large enough. The filter then rejects nearly all absent names locally and only ~1% leak to the DB. Cost: about 5 bits more per item and no deletes.",
  },
  {
    meta: { id: "rmq-poison-01", title: "Poison message loop in RabbitMQ", level: "senior", tags: ["rabbitmq", "dlx", "retries"], summary: "A few bad messages eat all consumer capacity.", locked: ["c", "q.consumers", "q.consumerRate"], criteria: [
      { metric: "rabbitmq.ready", op: "<", value: 2000, after: 30, label: "Backlog under 2,000" }, { metric: "rabbitmq.dlq", op: ">", value: 1, after: 40, label: "Bad messages are dead-lettered" }], hints: ["What happens to a message that always fails and is requeued?", "Which RabbitMQ feature parks failed messages?"] },
    scenario: sc("1.5k msg/s, 8% poison", 1500, 60),
    brief: "# Poison message loop\n\n8% of messages always fail. With auto-requeue they come straight back and consume consumer capacity until the backlog explodes.\n\nKeep the backlog under 2,000 **without changing consumer count or speed** and make sure bad messages end up somewhere inspectable.\n\n**Concepts:** DLX, redelivery limits, retry with backoff.",
    starter: [[client({ readRatio: 0 }), ["q", "rabbitmq", 300, 120, { consumers: 2, consumerRate: 1000, prefetch: 50, poisonRate: 0.08, dlx: false }]], [["c", "out", "q", "publish"]]],
    solution: [[client({ readRatio: 0 }), ["q", "rabbitmq", 300, 120, { consumers: 2, consumerRate: 1000, prefetch: 50, poisonRate: 0.08, dlx: true, maxRedeliveries: 3 }]], [["c", "out", "q", "publish"]]],
    writeup: "Enable a dead-letter exchange with a redelivery cap. Failed messages leave the hot path and land in a DLQ you can inspect or retry with backoff. Trade-off: you now own a DLQ runbook.",
  },
  {
    meta: { id: "kafka-lag-01", title: "Consumer lag: 50k/s into 6 partitions", level: "senior", tags: ["kafka", "consumer-group", "throughput"], summary: "Lag grows without bound.", locked: ["k.partitions", "c"], criteria: [
      { metric: "kafka.lagMax", op: "<", value: 10000, after: 60, label: "Max partition lag under 10,000" }, { metric: "e2e.errorRate", op: "<", value: 0.01, after: 20, label: "Errors under 1%" }], hints: ["How many consumers can one partition have?", "Total capacity is active consumers × per-consumer rate.", "Partitions are locked — what else is tunable?"] },
    scenario: sc("50k msg/s", 50000, 90),
    brief: "# Orders pipeline is falling behind\n\nInput is **50k msg/s**. The topic has **6 partitions (locked)**; each consumer handles 8k msg/s. Lag keeps growing.\n\nGet max-partition lag under 10,000 after 60 s with errors under 1%.\n\n**Concepts:** partition ceiling, idle consumers, processing speed.",
    starter: [[client({ readRatio: 0 }), ["k", "kafka", 300, 120, { partitions: 6, consumers: 3, consumerRate: 8000, partitionRate: 20000 }]], [["c", "out", "k", "produce"]]],
    solution: [[client({ readRatio: 0 }), ["k", "kafka", 300, 120, { partitions: 6, consumers: 6, consumerRate: 9500, partitionRate: 20000 }]], [["c", "out", "k", "produce"]]],
    writeup: "Parallelism is capped by partitions: one consumer per partition, so 6 consumers max. To reach 50k/s each consumer must do ≥ 8.4k/s — make processing faster (batching, lighter handlers). Alternative outside this lock: add partitions. Trade-off: partition count is hard to reduce later.",
  },
  {
    meta: { id: "credit-cliff-01", title: "Flash sale on a t2 fleet", level: "senior", tags: ["ec2", "cpu-credits", "cost"], summary: "Fine for ten minutes, then throttled.", locked: ["c"], budget: { maxCostPerHour: 0.5 }, criteria: [
      { metric: "e2e.errorRate", op: "<", value: 0.01, after: 200, label: "Errors under 1% late in the sale" }], hints: ["Look at CPU credits per instance over time.", "Baseline for a t2.small is 20%. What's the sustained load?", "Budget is $0.50/h. Compare burstable vs fixed-performance cost."] },
    scenario: sc("320 rps sustained", 320, 900),
    brief: "# Flash sale on a t2 fleet\n\nTwo `t2.small` instances handle the sale… until their CPU credits run out. Keep errors under 1% after 200 s of a 15 minute sale and stay under **$0.50/hour**.\n\n**Concepts:** CPU credits, baseline, sustained vs burst cost.",
    starter: [[client(), ["app", "ec2", 260, 120, { count: 2, vcpu: 1, memoryGiB: 2, burstable: true, creditsPerHour: 12, initialCredits: 4, networkMbps: 125, cpuCostMs: 5, costPerHourEach: 0.023 }, "API"]], [["c", "out", "app", "in"]]],
    solution: [[client(), ["app", "ec2", 260, 120, { count: 2, vcpu: 2, memoryGiB: 8, burstable: false, creditsPerHour: 0, initialCredits: 0, networkMbps: 750, cpuCostMs: 5, costPerHourEach: 0.096 }, "API"]], [["c", "out", "app", "in"]]],
    writeup: "Sustained 320 rps needs ~1.6 vCPU of work. Burstable instances only provide 20% baseline per vCPU once credits are gone, so a fixed-performance instance is both safer and, at this load, within budget. Trade-off: you lose burst-price savings for spiky workloads.",
  },
  {
    meta: { id: "cdc-lag-01", title: "Outbox + Debezium: WAL growing", level: "staff", tags: ["debezium", "cdc", "postgres", "kafka"], summary: "The connector can't keep up with writes.", locked: ["c", "pg"], criteria: [
      { metric: "debezium.lagMs", op: "<", value: 2000, after: 40, label: "CDC lag under 2 s" }, { metric: "debezium.walMB", op: "<", value: 500, after: 40, label: "Retained WAL under 500 MB" }], hints: ["Compare change rate to connector throughput.", "What does a lagging connector do to the source's disk?"] },
    scenario: sc("2k writes/s", 2000, 90),
    brief: "# Outbox + Debezium\n\nOrder writes stream through a Debezium connector into Kafka. The connector is slower than the write rate, so lag and WAL retention grow.\n\nBring CDC lag under 2 s and retained WAL under 500 MB. The source DB and load are locked.\n\n**Concepts:** CDC lag, WAL growth, connector scaling.",
    starter: [[client({ readRatio: 0 }), ["pg", "postgres", 260, 120, { writeQps: 20000, readQps: 20000 }], ["d", "debezium", 520, 120, { snapshotMode: "never", connectorRate: 800 }], ["k", "kafka", 780, 120, { partitions: 6, consumers: 6, consumerRate: 5000 }]], [["c", "out", "pg", "in"], ["pg", "cdc", "d", "source"], ["d", "events", "k", "produce"]]],
    solution: [[client({ readRatio: 0 }), ["pg", "postgres", 260, 120, { writeQps: 20000, readQps: 20000 }], ["d", "debezium", 520, 120, { snapshotMode: "never", connectorRate: 4000 }], ["k", "kafka", 780, 120, { partitions: 6, consumers: 6, consumerRate: 5000 }]], [["c", "out", "pg", "in"], ["pg", "cdc", "d", "source"], ["d", "events", "k", "produce"]]],
    writeup: "Connector throughput must exceed peak write rate with headroom; otherwise the source retains WAL until disk fills. Tune batch/queue sizes or split tables across connectors. Trade-off: more parallelism means weaker global ordering.",
  },
  {
    meta: { id: "hot-partition-01", title: "Hot partition at 10× Black Friday", level: "staff", tags: ["kafka", "partitioning", "skew"], summary: "One key dominates and one partition saturates.", locked: ["c"], criteria: [
      { metric: "e2e.errorRate", op: "<", value: 0.01, after: 20, label: "Errors under 1%" }, { metric: "kafka.lagMax", op: "<", value: 20000, after: 40, label: "Max lag under 20,000" }], hints: ["Where does 60% of traffic go?", "Salting a key spreads it across partitions.", "More partitions alone don't fix a single hot key."] },
    scenario: sc("Black Friday", 30000, 60),
    brief: "# Hot partition\n\nA flash-sale SKU makes **60% of messages share one key**, so one partition takes 18k msg/s but only handles 10k. Fix the skew so errors stay under 1% and lag stays bounded.\n\n**Concepts:** key salting, partition strategy, cost vs ordering trade-off.",
    starter: [[client({ readRatio: 0 }), ["k", "kafka", 300, 120, { partitions: 12, consumers: 12, consumerRate: 8000, partitionRate: 10000, hotKeyShare: 0.6 }]], [["c", "out", "k", "produce"]]],
    solution: [[client({ readRatio: 0 }), ["k", "kafka", 300, 120, { partitions: 12, consumers: 12, consumerRate: 8000, partitionRate: 10000, hotKeyShare: 0.1 }]], [["c", "out", "k", "produce"]]],
    writeup: "Salt the hot key (key + random suffix) so it spreads across partitions; consumers re-aggregate downstream. Trade-off: you lose strict per-key ordering for that key.",
  },
];

for (const s of specs) {
  const dir = `challenges/guided/${s.meta.id}`;
  mkdirSync(dir, { recursive: true });
  const ch: Challenge = { ...s.meta, scenario: s.scenario };
  writeFileSync(`${dir}/challenge.json`, JSON.stringify(ch, null, 2));
  writeFileSync(`${dir}/brief.md`, s.brief + "\n");
  writeFileSync(`${dir}/writeup.md`, s.writeup + "\n");
  writeFileSync(`${dir}/starter.design.json`, JSON.stringify(design(s.meta.title, ...s.starter, s.scenario), null, 2));
  writeFileSync(`${dir}/solution.design.json`, JSON.stringify(design(s.meta.title + " (solution)", ...s.solution, s.scenario), null, 2));
}
console.log(`wrote ${specs.length} challenges`);
