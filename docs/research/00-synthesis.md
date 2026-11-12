# Research synthesis and roadmap (phase 3)

Four research passes (files `01`–`04` in this folder) read primary sources — postmortems, vendor documentation, papers — and recorded, for each, the problem, the underlying concept, trade-offs, what to measure, and what a flow simulator can honestly model. This file consolidates them into decisions. Nothing here is a production-accuracy claim: parameters are scenario inputs, and each component's docs list what it simplifies.

## What the sources taught, in one place

| Theme | Sources (details in the numbered files) | Lesson that shaped the product |
| --- | --- | --- |
| Failover and split brain | GitHub 2018 (Orchestrator, 43 s partition, 24 h degradation); PostgreSQL replication docs; Aurora / RDS docs | Failover is a timer plus a data-loss window; automation that crosses regions can create two histories; async loses the unshipped log, sync costs latency and can stall. |
| Backups | GitLab 2017; PostgreSQL PITR docs | Replication copies corruption. A backup that fails silently has an RPO of "beginning of time". Restore time is size ÷ throughput plus log replay. |
| Overload and retries | Google SRE (cascading failures, handling overload); AWS Builders' Library (retries/backoff/jitter, load shedding) | Retries amplify load exactly when capacity is lowest; stale work in a deep queue sustains overload after the trigger ends (metastable failure); bound queues by age, not size. |
| Caching | Facebook memcache paper; AWS "avoiding fallback" themes | A cache outage is a database overload; fail-open protects availability and endangers the database; recovery (cold cache) is a second incident. |
| Messaging | Confluent exactly-once, RabbitMQ acks, Uber DLQ, Stripe idempotency, outbox/saga | Delivery is at-least-once; duplicates come from redelivery after rebalance/timeouts; effectively-once needs an idempotent sink with a retention window longer than the longest redelivery delay. |
| Deployments | Kubernetes Deployments / probes / HPA; AWS static stability; AWS 2021/2025 and Cloudflare 2025 postmortems | Readiness checks don't catch correctness regressions; blast radius = traffic share × time to detect; scaling takes time; the surviving region must already have capacity; client DNS caching stretches recovery. |
| Data stores | Dynamo paper; Cassandra docs; Discord (Cassandra → ScyllaDB); Elastic docs; ClickHouse insert docs; S3 performance docs; PACELC | Replication factor and consistency level are the availability/consistency dial; hot partitions defeat cluster size; indexing and querying contend for CPU. |

## Decisions: what became a component, a capability, a lab, or background

| Concept | Decision | Where |
| --- | --- | --- |
| Replica lag, stale reads, failover, split brain, sync/quorum commit, PITR, silent backup failure, connection pooling | **Standalone component** | `replicated-db` |
| Quorum reads/writes, hinted handoff, hot key, compaction, region-aware placement | **Standalone component** | `quorum-kv` |
| Query fan-out vs shard count, indexing/query contention, refresh interval, 429s | **Standalone component** (no heap/GC/merge claims: sources give no numbers) | `search-cluster` |
| Rolling / canary / blue-green, bad release, HPA on CPU or queue, graceful shutdown, cache fail-open | **Standalone component** | `app-service` |
| Load shedding, circuit breaker, bulkhead-style bounded queue | **Standalone component** | `api-gateway` |
| Idempotency, dedup window, fail-open/closed | **Standalone component** | `idempotency-store` |
| Retry policy, backoff, jitter, retry budget, timeouts | **Configuration** of the traffic source + **engine capability** (failure feedback to callers) | `client`, `core/simulation.ts` |
| Backpressure, dead-lettering, redelivery duplicates, requeue-on-failure | **Configuration** of messaging components | `kafka`, `rabbitmq` |
| Active-passive failover, health checks, DNS TTL, stale clients | **Configuration** of an existing component | `load-balancer` |
| Autoscaling signals (CPU, queue wait) | **Configuration** | `app-service` (ASG kept for the EC2 credits model) |
| Regions / zones, regional outage, cross-region RTT | **Engine capability** (boundaries are failure domains; components may declare how they survive) | `handlesRegionOutage`, `regionRttMs`, `kind:` fault targets |
| Duplicate tracking | **Engine capability** (`dupFraction` carried with flow) | `core/simulation.ts` |
| Consistent vs rendezvous hashing, retries/metastable failure, replication/failover, quorum/CAP | **Interactive playgrounds** | Labs |
| CAP/PACELC, exactly-once limits, saga, outbox | **Challenge background / write-ups** (no component) | write-ups, labs |
| Gossip, vector clocks, leader election, distributed locks (Kleppmann/fencing critique), Raft | **Deferred**: flow model is thin for these; best as playgrounds | roadmap |
| Columnar OLAP ("too many parts"), object storage (prefix limits), time-series, service mesh | **Deferred** (feasible; lower priority than what challenges needed) | roadmap |
| CockroachDB, MongoDB, ScyllaDB, DynamoDB as separate nodes | **Not added**: `quorum-kv` / `replicated-db` cover their modelled behaviours; separate nodes would be cosmetic | — |

## Modelling rules adopted

1. A behaviour must change a design decision to be modelled; otherwise it stays out (e.g. no JVM/GC internals).
2. Every number is a scenario input or a clearly labelled approximation; no vendor guarantees are asserted.
3. A dead end is an error. Only declared sinks (service endpoints, hidden terminal ports) complete requests, so a design can never "pass" by connecting nothing.
4. Failures flow upstream one tick later (attributed to the edges that fed the failing node), except through async boundaries (queues/logs); components that absorb failures (retry, requeue, fall back) say so via `recovered`.
5. Open-ended challenges are judged by simulation against criteria the author defines, over public and hidden scenarios; budgets use peak spend.

## Roadmap

Done this phase: components and capabilities above; 9 open-ended challenges (+ 7 guided exercises kept separately); grading v2; catalog with search/filters; 8 labs.

Next, in priority order: (1) columnar/OLAP store ("too many parts") and object storage (prefix throttling) with challenges; (2) WebSocket-scale and hot-key/consistency challenges using existing components; (3) lock/lease playground with fencing tokens, gossip and vector-clock playgrounds; (4) per-region component placement for stores spanning regions with their own latency; (5) request tracing view.
