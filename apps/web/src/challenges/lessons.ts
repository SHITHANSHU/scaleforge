import { R, type Ref } from "../docs/guides";

export interface Lesson {
  /** What you will learn, in one sentence. */
  objective: string;
  /** Ordered steps: observe, then change, then verify. */
  steps: { title: string; body: string }[];
  /** Questions to answer for yourself after passing. */
  reflect: string[];
  refs: Ref[];
}

/** Step-by-step guidance for each guided exercise, keyed by exercise id. Exercises without an entry show only their brief. */
export const lessons: Record<string, Lesson> = {
  "cache-aside-01": {
    objective: "See how a cache changes the load a database must carry.",
    steps: [
      { title: "Run the starter", body: "Press Space. Open Bottlenecks and note which tier saturates first." },
      { title: "Read the database panel", body: "Select PostgreSQL. Compare its read capacity with the 4,000 req/s arriving (95% reads)." },
      { title: "Add a cache on the read path", body: "Place Redis between the app and the database: app → cache, and the cache's miss port → database. Writes still reach the database." },
      { title: "Size it", body: "Select Redis and read 'Items that fit' and the estimated hit ratio. Adjust memory or TTL until the database falls below 80% utilisation." },
      { title: "Check the cold start", body: "Run again and watch the first seconds: the hit ratio starts at zero. How long until the database is relieved?" },
    ],
    reflect: ["What happens to the database if the cache is flushed at peak?", "What does a longer TTL cost you?"],
    refs: [R.memcache, R.redisEviction],
  },
  "bloom-username-01": {
    objective: "Understand how sizing and overfill change a Bloom filter's false-positive rate.",
    steps: [
      { title: "Read the derived values", body: "Select the Bloom filter. Note bits, hash functions and the false-positive rate at the current fill." },
      { title: "Find the problem", body: "Expected items is 100,000 but 400,000 are loaded. The rate is far above target and the database pays for every false positive." },
      { title: "Resize", body: "Raise Expected items above the real count with headroom and watch the derived rate return to target." },
      { title: "Confirm by measurement", body: "Run and compare 'FP rate (observed)' with theory: the filter is real, so they should agree." },
    ],
    reflect: ["Why can't a Bloom filter delete?", "What is the memory cost of a lower false-positive target?"],
    refs: [R.bloom],
  },
  "rmq-poison-01": {
    objective: "Learn why messages that always fail must leave the hot path.",
    steps: [
      { title: "Run and watch the backlog", body: "Without a dead-letter exchange, failed messages are requeued and fail again, crowding out good ones." },
      { title: "Read the warning", body: "The inspector flags 'No DLX on this queue'. Hover it and read why." },
      { title: "Enable the dead-letter exchange", body: "Turn on the DLX so failures are parked instead of looping. Check that the 'Dead-lettered' metric rises." },
    ],
    reflect: ["How would you detect and replay dead-lettered messages?", "What is a sensible redelivery limit?"],
    refs: [R.rabbitConfirms, R.uberDlq],
  },
  "kafka-lag-01": {
    objective: "Work out the real parallelism limit of a consumer group.",
    steps: [
      { title: "Compute capacity", body: "Group ceiling = active consumers × per-consumer rate. Active consumers are capped by partitions." },
      { title: "Read the derived panel", body: "Select Kafka and compare 'Group consumption ceiling' with the 50,000/s input." },
      { title: "Choose a lever", body: "Partitions are locked, so raise consumers up to the partition count and per-consumer speed (batching, lighter handlers)." },
    ],
    reflect: ["Why can't you reduce partitions later?", "What would adding partitions cost?"],
    refs: [R.kafkaDocs, R.confluentEO],
  },
  "credit-cliff-01": {
    objective: "Understand burstable CPU credits and why sustained load breaks them.",
    steps: [
      { title: "Run for 15 simulated minutes", body: "Use a high speed. Watch 'CPU credits' fall and throughput collapse when they reach zero." },
      { title: "Read the baseline", body: "A t2.small earns credits for 20% of a vCPU. Compare that with 320 req/s × 5 ms." },
      { title: "Pick a different instance class", body: "Switch to a fixed-performance instance and check cost against the $0.50/h budget." },
    ],
    reflect: ["For which workloads is burstable the right choice?"],
    refs: [R.ec2Credits],
  },
  "cdc-lag-01": {
    objective: "See how a slow CDC connector turns into database disk pressure.",
    steps: [
      { title: "Compare rates", body: "Connector throughput must exceed the write rate. Read 'CDC lag' and 'WAL retained' while running." },
      { title: "Raise connector throughput", body: "Increase it with headroom and confirm lag falls under 2 s." },
    ],
    reflect: ["What happens to the source if the connector stops entirely?"],
    refs: [R.debezium, R.outbox],
  },
  "hot-partition-01": {
    objective: "Understand why one hot key defeats a well-sized cluster.",
    steps: [
      { title: "Find the hot partition", body: "Select Kafka: max-partition lag is far above the average. The hot-key share sends traffic to one partition." },
      { title: "Spread the key", body: "Salting the key lowers the hot-key share. Reduce it and compare lag." },
    ],
    reflect: ["What ordering guarantees do you give up by salting?"],
    refs: [R.kafkaDocs, R.discord],
  },
  "replica-lag-01": {
    objective: "Relate replication lag to the stale reads users actually see.",
    steps: [
      { title: "Run and read lag", body: "Select the database. 'Worst replica lag' grows because writes exceed the apply rate." },
      { title: "Read the staleness", body: "'Stale reads' follows lag. Users see old data right after writing." },
      { title: "Change the read routing", body: "Try Primary only (always fresh), then Lag-aware. Compare stale reads and primary utilisation." },
    ],
    reflect: ["When is read-your-writes routing better than lag-aware routing?"],
    refs: [R.pgHA, R.rdsReplicas],
  },
  "retry-amplification-01": {
    objective: "See how retry policy decides whether a blip recovers.",
    steps: [
      { title: "Run the starter", body: "Watch retry traffic on the edge: it matches or exceeds offered load, keeping the service saturated." },
      { title: "Compare presets", body: "On the traffic source, apply 'Naive' then 'Backoff + jitter + 10% budget' and compare recovery." },
      { title: "Read the derived multiplier", body: "The inspector shows the worst-case load multiplier your policy allows." },
    ],
    reflect: ["Why does jitter help even when the average delay is unchanged?", "Where should retries live: client, gateway, or both?"],
    refs: [R.awsRetries, R.sreCascading],
  },
  "load-shedding-01": {
    objective: "Learn why rejecting some work early protects the rest.",
    steps: [
      { title: "Run the starter", body: "Demand exceeds capacity. Watch latency climb as the queue deepens." },
      { title: "Add a gateway", body: "Place an API gateway in front of the service with shedding by queue age enabled." },
      { title: "Tune the age bound", body: "A shorter bound sheds more but keeps latency lower. Find the balance that meets the goals." },
    ],
    reflect: ["Which clients should be shed first?", "How does shedding interact with client retries?"],
    refs: [R.awsShedding, R.sreOverload],
  },
  "bad-release-01": {
    objective: "Limit blast radius with release strategy and automatic rollback.",
    steps: [
      { title: "Run the starter", body: "A rolling release without rollback ends at 100% on the bad version." },
      { title: "Switch to canary", body: "Send a small share first and hold, so exposure is limited." },
      { title: "Enable automatic rollback", body: "Set an error threshold and confirmation time, then check the Timeline for the rollback." },
    ],
    reflect: ["What would make your detection too slow?", "What does blue-green cost during a rollout?"],
    refs: [R.k8sDeploy, R.k8sProbes],
  },
  "duplicate-charge-01": {
    objective: "Turn at-least-once delivery into effectively-once execution.",
    steps: [
      { title: "See the duplicates", body: "Run and watch the duplicate rate during the slow period: a timed-out request may still complete." },
      { title: "Add an idempotency store", body: "Place it before the payment service." },
      { title: "Choose the window", body: "Retention must exceed the longest duplicate delay. Read 'Duplicates caught' in the inspector." },
    ],
    reflect: ["What should happen when the store is down: fail open or fail closed?"],
    refs: [R.stripeIdem, R.confluentEO],
  },
  "quorum-availability-01": {
    objective: "Use R + W > RF to trade availability against consistency.",
    steps: [
      { title: "Read the derived panel", body: "'Consistency' and 'Node failures tolerated' update as you change levels." },
      { title: "Try ALL, then QUORUM, then ONE", body: "Compare availability and stale reads with one node down." },
      { title: "Pick the combination that meets both goals", body: "It must overlap reads and writes and tolerate one failure." },
    ],
    reflect: ["How does latency change as you wait for more replicas?"],
    refs: [R.dynamo, R.cassandra, R.pacelc],
  },
};
