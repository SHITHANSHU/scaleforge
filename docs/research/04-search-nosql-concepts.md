# 04 - Search, NoSQL/quorum, columnar, object storage, distributed-systems concepts

Scope: sources below were fetched and read (HTML via WebFetch; PDFs downloaded and text-extracted locally). Numbers are quoted from the sources, not from experiments. Elasticsearch mapping-limit doc (a 404) and any source not fetched were dropped. Not covered by a fetched source: segment-merge internals, JVM GC mechanics for ES, rendezvous-vs-consistent hashing (no primary source fetched; mention only as background).

## Sources

### 1. Elastic - Size your shards
**Source**: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards
**Problem/concept**: Shard count and size drive cluster stability. Guidance: shards of 10GB-50GB; keep documents per shard below 200 million; fewer than 3000 indices per GB of heap on master nodes; max 1000 non-frozen shards per node. Lucene hard limit about 2.1 billion docs per shard (active plus deleted).
**Why it matters / failure mode**: Oversharding: "searches across a large number of shards can deplete a node's search thread pool", giving low throughput and instability. Oversized shards slow search and prolong recovery; watermark errors and hot spotting.
**Trade-offs**: Few large shards = slow recovery, poor parallelism, hotspots. Many small shards = per-shard overhead, fan-out cost.
**Observe/measure**: shards per node, shard size distribution, search thread-pool queue/rejections, recovery time after node loss.
**Simulatable?**: Yes, as a **standalone component** (search cluster) with config: shard count, replicas. Fan-out query cost = f(shards); tail latency = max over shards. Do NOT claim real Lucene behavior, heap-per-shard constants, or exact thresholds as universal; they are guidance.

### 2. Elastic - Tune for indexing speed
**Source**: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed
**Problem/concept**: Indexing and search compete for resources in one cluster. Refresh interval can be set to -1 during bulk loads (restore e.g. 5s after). Bulk sizing: start at 100 docs and double; keep requests to "a couple tens of megabytes". Force merge is expensive. Replicas disabled during initial load speeds indexing but risks data loss.
**Why it matters / failure mode**: Too many concurrent writers risk 429 rejections; a single thread cannot saturate indexing capacity. Search load degrades indexing and vice versa.
**Trade-offs**: Short refresh = fresher search but more indexing work; replicas = durability/read capacity vs write cost.
**Observe/measure**: indexing throughput, 429 rate, refresh interval, search p99 under concurrent indexing, time-to-searchable.
**Simulatable?**: **Configuration of the search component**: refresh_interval (staleness vs write cost), shared capacity pool between index and query (contention), 429-style rejection when queue is full. Do NOT claim modeling of merge scheduling, GC pauses, or heap pressure; the page does not quantify them and we did not fetch a source that does. Treat GC as a stylized "stall" parameter if included, clearly labeled.

### 3. Discord - How Discord Stores Trillions of Messages
**Source**: https://discord.com/blog/how-discord-stores-trillions-of-messages
**Problem/concept**: Cassandra to ScyllaDB migration. Issues: hot partitions (a small server vs one with hundreds of thousands of members), compaction forcing a "gossip dance" (rotating nodes out), GC tuning ("GC pauses would cause significant latency spikes"), uncompacted tombstone ranges. Scale: 12 nodes (2017) to 177 nodes (early 2022) to 72 ScyllaDB nodes. Reported p99: historical fetch 40-125ms to 15ms; inserts 5-70ms to 5ms.
**Why it matters / failure mode**: One hot partition causes "cascading latency" for the replicas and coordinators touching it. Rust data services coalesce identical concurrent reads ("only query the database once") and use consistent-hash routing so all requests for a channel reach one instance.
**Trade-offs**: Coalescing cuts load but adds a routing tier and in-flight-request state. Fewer, bigger nodes vs operational simplicity.
**Observe/measure**: per-partition request rate, p99 by partition, coalescing hit ratio, compaction backlog.
**Simulatable?**: **Challenge background plus a configuration** of a quorum KV (key skew, hot-key coalescing/cache toggle). Do NOT claim the vendor latency numbers apply or that ScyllaDB is inherently faster in the simulator; those are one company's reported results.

### 4. Apache Cassandra docs - Dynamo architecture
**Source**: https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html
**Problem/concept**: Replication factor RF; consistency levels (ONE, TWO, THREE, QUORUM, ALL, LOCAL_QUORUM, EACH_QUORUM, LOCAL_ONE, ANY for writes); strong-read condition `W + R > RF`; vnodes (multiple tokens per node, new nodes take about equal data); gossip (every second a node exchanges state with a random node); read repair and hinted handoff as best-effort convergence.
**Why it matters / failure mode**: Choosing R/W below quorum yields stale reads; replicas diverge when nodes are down; convergence is "best-effort".
**Trade-offs**: Higher consistency level = higher latency and lower availability under node failure; lower = faster, possibly stale.
**Observe/measure**: stale-read rate, coordinator latency per CL, unavailable errors when too few replicas are up, hint backlog.
**Simulatable?**: **Standalone component (quorum KV store)**. Deterministic: replica set per key, per-replica latency, ack after R/W responses, availability when live replicas < required. Do NOT claim Cassandra-exact repair/hint timing; do not claim linearizability from `W+R>RF` alone (docs state visibility of writes to later reads, not full linearizability).

### 5. DeCandia et al. - Dynamo: Amazon's Highly Available Key-value Store (SOSP 2007)
**Source**: https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf
**Problem/concept**: Always-writable store using consistent hashing, N/R/W quorum ("The common (N,R,W) configuration ... is (3,2,2)"), sloppy quorum and hinted handoff (a replica for down node A goes to D with a hint, delivered on recovery), vector clocks as (node, counter) pairs for causality, Merkle trees for anti-entropy, gossip for membership. SLAs are expressed at the 99.9th percentile (e.g. response within 300ms for 99.9% of requests).
**Why it matters / failure mode**: Concurrent writes yield divergent versions that the client must reconcile; vector clocks can grow (the paper truncates them); sloppy quorum trades strictness for availability.
**Trade-offs**: Availability and write latency vs consistency; (R=1) fast reads vs (W=1) fast writes; reconciliation burden moves to the application.
**Observe/measure**: p99.9 latency, divergent-version rate, hint handoff queue, anti-entropy bytes.
**Simulatable?**: **Same quorum component, optional advanced mode**: sloppy quorum on/off, conflict counter. Vector clocks only as a **playground/background** concept (a tiny interactive widget), not a flow-simulation feature. Do NOT claim Merkle-tree repair cost modeling.

### 6. ClickHouse docs - Selecting an insert strategy
**Source**: https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy
**Problem/concept**: Each synchronous insert creates a part; small batches create many parts and the "too many parts" error. Recommended batches: at least 1,000 rows, ideally 10,000-100,000, about one insert per second so background merges keep up. Async inserts buffer (defaults: 100 MiB, 200 ms or 1000 ms on Cloud, 450 queries) and flush; high-cardinality partition keys can still cause too many parts.
**Why it matters / failure mode**: Merge throughput is finite; part creation faster than merging degrades queries and ends in insert errors.
**Trade-offs**: Batching/async = fewer parts but added latency and durability considerations (`wait_for_async_insert`).
**Observe/measure**: parts per partition, insert rate vs merge rate, query latency vs part count, insert error rate.
**Simulatable?**: **Standalone component (columnar store)** with a clean queue model: parts = arrivals - merges; query cost grows with part count; reject above a threshold. Do NOT claim real merge-selection algorithms or the doc defaults as fixed thresholds of the simulator's engine.

### 7. AWS - Optimizing Amazon S3 performance
**Source**: https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html
**Problem/concept**: "at least 3,500 PUT/COPY/POST/DELETE or 5,500 GET/HEAD requests per second per partitioned prefix"; no limit on prefixes; scaling is gradual, and during it you may see 503 (Slow Down); consistent small-object latency "roughly 100-200 milliseconds"; parallelize across prefixes (10 prefixes = 55,000 reads/s).
**Why it matters / failure mode**: A hot prefix, or a sudden ramp, yields 503 until scaling completes; clients must retry with backoff.
**Trade-offs**: Prefix design vs listing convenience; caching (CloudFront/ElastiCache) for single-digit-ms latency.
**Observe/measure**: 503 rate, per-prefix request rate, retry amplification, latency by object size.
**Simulatable?**: **Standalone component (object storage)**, simple: per-prefix rate limit with gradual autoscale, 503 and retry. Consistency model was not on the fetched page; do NOT assert S3 consistency semantics from this source. Do NOT claim the numbers are hard guarantees ("at least" and "varies by workload").

### 8. Kleppmann - How to do distributed locking
**Source**: https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
**Problem/concept**: Locks with leases fail under process pauses (GC), clock jumps, and delayed packets (cites a GitHub incident of about 90 seconds delay). Fix: fencing tokens, a monotonically increasing number issued at each acquisition, checked by the storage. "Redlock does not have any facility for generating fencing tokens." Recommends single-node Redis for efficiency-only locks and consensus (e.g. ZooKeeper) for correctness.
**Why it matters / failure mode**: Two clients both believe they hold the lock and corrupt shared data.
**Trade-offs**: Efficiency locks (occasional double work OK) vs correctness locks (need fencing and consensus).
**Observe/measure**: lease expiry vs holder pause, writes rejected for stale token, double-holder windows.
**Simulatable?**: **Interactive playground / timeline** (deterministic pause injection, token on/off) is a strong fit; a flow-based lock service is weak. Note this is one side of a public dispute (Redlock's author disagreed); present as a critique, not settled fact. Do NOT claim clock-skew modeling in the flow engine unless clocks are explicitly added.

### 9. Abadi - Consistency Tradeoffs in Modern Distributed Database System Design (PACELC)
**Source**: https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf
**Problem/concept**: "if there is a partition (P), how does the system trade off availability and consistency (A and C); else (E), ... latency (L) and consistency (C)?" CAP says nothing about normal-operation tradeoffs; PACELC adds the latency/consistency one.
**Why it matters / failure mode**: Teams pick "AP" and ignore that replication already costs latency/consistency when no partition exists.
**Trade-offs**: Per-system classification (paper classifies e.g. MongoDB, PNUTS) is nuanced.
**Observe/measure**: latency vs consistency level in steady state; behavior during partition.
**Simulatable?**: **Challenge background**, and it falls out of the quorum component (consistency level vs latency curve; partition = replicas unreachable). Do NOT claim the simulator proves CAP.

### 10. Ongaro & Ousterhout - Raft (extended version)
**Source**: https://raft.github.io/raft.pdf
**Problem/concept**: Leader election with randomized election timeouts "chosen randomly from a fixed interval (e.g., 150-300ms)" to make split votes rare; election needs votes from a majority; the cluster is available while any majority is operational (five servers tolerate two failures).
**Why it matters / failure mode**: Minority partition cannot elect or commit (no split brain among committed writes); no majority means unavailability; split votes cause repeated elections.
**Trade-offs**: Strong consistency vs availability for the minority side; shorter timeouts = faster failover but spurious elections.
**Observe/measure**: time to new leader, writes rejected during election, term changes.
**Simulatable?**: **Engine capability candidate** (node failure/partition events with majority rules) shared by lock service and quorum KV; full Raft log replication is out of scope. Do NOT claim a faithful Raft implementation.

## Component feasibility ranking (usefulness vs modeling feasibility)

| Rank | Component | Usefulness | Feasibility | Concrete behaviors |
|---|---|---|---|---|
| 1 | Quorum KV store | High (teaches CL, replication, hot keys) | High | (a) ack after R/W of N replicas; unavailable when live < needed; (b) skewed keys overload one replica set, p99 follows slowest replica; (c) node down leads to hint backlog and degraded latency |
| 2 | Columnar OLAP store | Medium-high (batching is a very common real mistake) | High | (a) parts accumulate when insert rate > merge rate; (b) query latency rises with part count; (c) batching/async buffer trades latency for fewer parts |
| 3 | Object storage | Medium (ubiquitous, simple) | High | (a) per-prefix rate limit with gradual scale-up; (b) 503 then client retry storm; (c) latency by object size, caching in front |
| 4 | Search cluster | High (common interview topic) | Medium | (a) query fans out to all shards, latency = slowest shard; (b) shared index/query capacity with 429 rejections; (c) refresh interval trades staleness vs indexing cost. Avoid heap/GC/merge claims |
| 5 | Lock service | Medium (concepts matter, flow model is thin) | Low as flow; High as playground | (a) lease expiry vs pause leads to double holder; (b) fencing token rejects stale writer; (c) leader loss leads to unavailable window |

## Challenge seeds (technology-neutral)

1. A product's feed lookups are fast on average, but a handful of very popular accounts cause latency spikes for unrelated users stored on the same machines. Fix it without adding hardware per account.
2. Search results must reflect a new listing within a few seconds, yet nightly catalog re-imports make live queries time out. Rebalance freshness, throughput and query latency.
3. A metrics pipeline writes one tiny batch per event; dashboards worsen steadily over hours and then writes start failing. Restore stability without dropping data.
4. A data-heavy app stores millions of files; during a launch, reads for files with similar names error out for a minute, then recover. Keep launch traffic healthy.
5. Two workers occasionally process the same job and corrupt a shared record after one of them stalls briefly. Guarantee exactly one effective writer under stalls and a node loss, within a stated availability budget.
