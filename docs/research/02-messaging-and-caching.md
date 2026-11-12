# Messaging and caching failures: research for ScaleForge

All sources fetched 2026-11-11. Claims below are only what the fetched text stated. Where a number appears it is quoted from the source.

## 1. Scaling Memcache at Facebook (NSDI '13)
**Source:** https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf (read pp. 387-390 only)
- **Problem:** Stale sets and thundering herds. A key under heavy read and write activity is repeatedly invalidated, so many reads fall through to the database. A cache outage also pushes excess load onto backends and can cascade.
- **Concept:** Admission control for cache misses (leases), failure isolation (Gutter pool), invalidation as a pipeline.
- **Trade-offs/recovery:**
  - Leases: a 64-bit token per key, issued at most once per 10 s per key by default. Other readers wait briefly and retry. The paper reports a peak DB query rate of 17K/s without leases versus 1.3K/s with them, measured on keys prone to herds over one week.
  - Gutter: about 1% of the cluster takes over for failed servers. Entries expire quickly, so the cost is slightly stale data. The paper says it cut client-visible failures by 99% and converted 10-25% of failures into hits.
  - Rehashing keys onto the remaining servers was rejected because one key can carry 20% of a server's requests.
  - Invalidation: deletes are extracted from the commit log and batched (18x improvement in median deletes per packet). Only 4% of deletes actually invalidate data.
- **Observe:** hit ratio per pool, DB QPS on miss, miss-storm peak vs. provisioned DB capacity, per-key request share, staleness window.
- **Simulatable:** Yes: hit ratio, miss-rate multiplier onto a DB node, a per-key lease/single-flight toggle, a spare pool, a cache node kill. **Do not claim** 17K/1.3K, 99% or 35% as ScaleForge outputs. They are one company's measurements. Per-key identity, LRU and real invalidation races are not modeled unless keys are explicit.

## 2. AWS Builders' Library: Timeouts, retries and backoff with jitter
**Source:** https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ (redirects to builder.aws.com)
- **Problem:** Retries at every layer multiply load. A five-layer stack with 3 retries each gives "243x" load on the database.
- **Concept:** Retry amplification, metastable overload, jitter to de-synchronize clients, retry budgets (token bucket), idempotency as a precondition for retry.
- **Trade-offs:** Retry at one layer only. Use capped exponential backoff plus jitter. The article discusses token-bucket throttling (the AWS SDK example) and calls circuit breakers problematic because their modal behavior is hard to test. Timeouts should come from latency percentiles (a 0.1% false-timeout rate maps to p99.9).
- **Observe:** retry rate / first-attempt rate, goodput vs. offered load, per-layer attempt counts, timeout rate.
- **Simulatable:** Yes: retry policy (max attempts, backoff, jitter, budget) and layered amplification. **Do not claim** that circuit breakers are bad. The source says they are hard to test, not that they are ineffective.

## 3. AWS Builders' Library: Avoiding fallback in distributed systems
**Source:** https://aws.amazon.com/builders-library/avoiding-fallback-in-distributed-systems/ (redirects to builder.aws.com)
- **Problem:** The article describes an Amazon retail incident from 2001. A shipping-speed cache fell back to direct DB queries. When all caches failed, every web server hit the database and the site and fulfillment stopped.
- **Concept:** Fallback paths are rarely exercised, so they fail under stress and widen the blast radius. This is a cache-outage-to-DB-overload mechanism.
- **Trade-offs:** Make the primary more reliable, push data proactively, turn fallback into an always-exercised failover, or use hedging instead of reactive fallback.
- **Observe:** DB QPS vs. cache hit ratio, share of traffic taking the fallback path, DB saturation.
- **Simulatable:** Yes: cache-to-DB fallback with a cache kill. **Do not claim** the 2001 event's magnitude or duration. The article gives none.

## 4. Slack: incident of 2022-02-22
**Source:** https://slack.engineering/slacks-incident-on-2-22-22/
- **Problem:** Consul agent upgrades rolled through 25% of the memcached fleet. The Mcrib control plane kept promoting spare nodes and updating Mcrouter, so cache hit rates dropped at peak traffic. The resulting load fell on a Vitess keyspace, and a scatter query on group-DM membership (sharding key absent from the query) made it worse.
- **Concept:** Cache churn from control-plane automation, a cold cache at peak, an expensive query shape under load, and a cascading failure.
- **Recovery:** Throttle client boot requests, rewrite the scatter query to a channel-sharded table, read from replicas, and restore rate limits gradually as caches refilled.
- **Observe:** hit ratio over time, DB load, cold-start admission rate, cost per miss.
- **Simulatable:** Partly: hit-ratio drop plus a per-miss cost multiplier, with admission throttling as the mitigation. **Do not claim** durations. The post gives none.

## 5. Stripe: Designing robust and predictable APIs with idempotency
**Source:** https://stripe.com/blog/idempotency
- **Problem:** A client can't tell whether a failed request took effect, so it must be able to retry safely.
- **Concept:** Client-generated idempotency key, with the server returning the stored result for a repeat. The post recommends exponential backoff with jitter to avoid a thundering herd.
- **Trade-offs:** A store of keys and results, plus an expiry policy. The fetched text did not cover storage, atomic phases or key TTL, so none of that is claimed here.
- **Observe:** duplicate-request fraction, replay hit rate, double-effect count (must be 0).
- **Simulatable:** Yes: an idempotency store with a TTL, where an expired key allows double execution. **Do not claim** Stripe's specific TTL.

## 6. Confluent: Exactly-once semantics in Apache Kafka
**Source:** https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/
- **Problem:** Producer retries create duplicates in the log, and consumer crashes between processing and commit cause reprocessing.
- **Concept:** Idempotent producer (sequence numbers dedup on the broker), atomic multi-partition transactions, `read_committed`. The guarantee holds only inside Kafka. An RPC to a remote store is not covered.
- **Trade-offs:** For 1 KB messages, transactional throughput dropped about 3% versus at-least-once (their measurement).
- **Observe:** duplicate fraction at the sink, redelivery count, offset-commit gap.
- **Simulatable:** Yes: at-least-once delivery with a duplicate fraction and a dedup window. **Do not claim** that ScaleForge gives "exactly-once". Model effectively-once as at-least-once plus idempotent sinks.

## 7. RabbitMQ: Consumer acknowledgements and publisher confirms
**Source:** https://www.rabbitmq.com/docs/confirms
- **Problem:** A consumer that disconnects before acking causes redelivery. If every consumer requeues on a transient error, they create a requeue/redelivery loop that burns CPU and bandwidth.
- **Concept:** Ack-based at-least-once delivery, prefetch as backpressure, a poison-message loop. Publisher confirms cover only publisher-to-broker, so end-to-end safety needs both confirms and acks.
- **Trade-offs:** Track redelivery counts and discard or delay-requeue. The docs say prefetch of 100-300 usually gives good throughput, prefetch of 1 gives the lowest, and unlimited risks consumer memory exhaustion.
- **Observe:** queue depth, unacked count, redelivery ratio, consumer utilization.
- **Simulatable:** Yes: ack timeout, requeue and a prefetch cap. **Do not claim** the 100-300 range as universal.

## 8. Uber: Building reliable reprocessing and dead letter queues with Kafka
**Source:** https://www.uber.com/blog/reliable-reprocessing/
- **Problem:** A failing message blocks offset commit and stalls the partition (head-of-line blocking).
- **Concept:** Retry topics with delays, then a final dead-letter topic with list, purge and merge (replay) operations. Ordering is traded for throughput, so consumers must be idempotent.
- **Observe:** retry-queue depth by stage, DLQ arrival rate, age of the oldest message, consumer lag.
- **Simulatable:** Yes: staged retry queues, a DLQ, and a failing-message fraction. **Do not claim** Uber's volumes. None were extracted.

## 9. microservices.io: Transactional outbox and Saga
**Sources:** https://microservices.io/patterns/data/transactional-outbox.html and https://microservices.io/patterns/data/saga.html
- **Problem:** Updating a DB and publishing a message atomically without 2PC, and coordinating multi-service transactions.
- **Concept:** The outbox writes the message in the same local transaction, and a relay (polling or log tailing) publishes it. The relay may publish duplicates if it crashes after sending but before marking, so consumers must be idempotent. A saga is a sequence of local transactions with compensations, using choreography or orchestration. It has no automatic rollback and lacks isolation, so it needs countermeasures.
- **Observe:** outbox backlog age, relay duplicate rate, saga completion and compensation counts, stuck sagas.
- **Simulatable:** Partly: relay as a queue with a duplicate fraction, and a saga as a chain with a compensation path. **Do not claim** the ACID isolation anomalies are modeled.

## Challenge seeds
1. **The lunchtime stall.** An order pipeline's backlog grows after a deploy. Symptoms: lag rising while consumers look busy, and downstream DB CPU high. Requirements: recover with no lost orders. Constraints: consumers are slow only for some inputs. Success: lag < 60 s at p95 within N sim-minutes, loss = 0, duplicates at the sink = 0. Valid designs: separate retry lanes, partitioning, shedding, autoscaling, a poison-message quarantine.
2. **Everyone retries.** A downstream dependency slows for 30 s, and ten minutes later the system is still overloaded. Requirements: bounded recovery time. Constraints: clients are heterogeneous. Success: goodput back to 95% of baseline within a target time, with total attempts ≤ 2x offered load. Valid designs: retry budgets, jitter, a single retry layer, breakers, load shedding.
3. **Charged twice.** Payment confirmations arrive twice after network blips. Requirements: no double effect. Constraints: the sink cannot be changed. Success: double effects = 0 across a fault-injected run, with added latency under a limit. Valid designs: dedup keys with sufficient retention, natural-idempotent writes, a transactional log of effects, a reconciliation job.
4. **Cold start at peak.** The cache fleet is partly replaced during peak traffic. Requirements: the database must survive. Constraints: the DB cannot be scaled in time. Success: DB utilization < 85% throughout, hit ratio rebuilt within a target time, with a bounded error rate. Valid designs: request coalescing, admission throttling, a warm standby, staged rollouts, serving stale data.
5. **One celebrity key.** A single item receives a large share of reads and one cache node saturates. Requirements: keep latency flat. Constraints: updates must reach users within a freshness bound. Success: the max node share is below a threshold, p99 stays under target, staleness is within the bound. Valid designs: replicating hot keys, local near-caches, key splitting, short TTL with coalescing.

## Modeling notes
- **Retry policy:** attempts per layer (so amplification is visible), capped exponential backoff, jitter on or off, a retry budget (token bucket), a timeout distinct from the failure, and an idempotent-vs-not flag. Retry only on retryable errors. Count attempts separately from first tries.
- **Circuit breaker:** closed, open and half-open states, a trip threshold, a probe rate, and a reset timeout. Surface the mode so learners see it. A breaker only helps when something sits behind it (fallback or shedding), and a fallback path can itself overload the DB.
- **Idempotency store:** a key-to-result map with a TTL, so a retry after expiry becomes a duplicate. Concurrent in-flight duplicates need an in-progress marker. A store outage must choose fail-open (risk duplicates) or fail-closed (reject).
- **Dedup window:** bounded in size or time, so duplicates older than the window pass through. Report the duplicate fraction at the sink separately from the broker.
- **Queues:** at-least-once redelivery on ack timeout, a prefetch cap as backpressure, a retry count that diverts to a DLQ, and head-of-line blocking when one item fails repeatedly.
- **Cache:** a hit ratio that drives DB load as (1 - hit) x rate, a miss cost, a single-flight/lease toggle, and a cold-start ramp after a node loss.
- **Claims to avoid:** exactly-once delivery as a base capability (only effectively-once via idempotent sinks), real clock or ordering semantics beyond what the fixed-step model provides, and any quoted production number as simulator output.
