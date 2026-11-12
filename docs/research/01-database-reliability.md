# Database reliability: research for ScaleForge

All sources below were fetched this session. Figures are quoted from those pages only. Jepsen's PostgreSQL 12.3 report was fetched and dropped: it covers single-node isolation bugs, not replication or failover.

## 1. GitHub, October 21 2018 incident
**Source**: "October 21 post-incident analysis", https://github.blog/news-insights/company-news/oct21-post-incident-analysis/
**What happened**: A 43-second connectivity loss between the US East Coast hub and the primary data center (22:52 UTC) made Orchestrator reorganize the US West Coast database topologies. When connectivity returned, apps wrote to West Coast primaries, while East Coast held writes never replicated west (954 writes in one busy cluster). Degraded service lasted 24h11m.
**Why it failed / concept**: Automated failover ran across regions during a partition. That produced two divergent write histories (split brain), so failback was unsafe. Apps also could not tolerate cross-country DB latency.
**Trade-offs & recovery**: Recovery meant restoring multi-TB backups from remote storage, resyncing replicas across DCs, adding East read replicas to cut lag, and draining the backlog. GitHub paused webhooks and Pages builds to protect data integrity. Lessons: stop Orchestrator failing over across regions, add finer status reporting, and test failure scenarios with chaos/fault injection. Async replication favors availability and latency; it risks losing or diverging writes.
**Observe/measure**: unreplicated writes at failover (RPO), time to a single agreed primary, replication lag during the catch-up, queued work (5M+ webhook events, 80k Pages builds), work dropped past TTL (~200k payloads).
**Simulatable?** Yes: two regions, a partition fault, a failover controller with a promote-on-timeout policy, per-region write logs, and a divergence counter. It could also model downstream queue backlog and TTL drops. It must NOT claim to reproduce Orchestrator or MySQL internals, or exact timings.

## 2. GitLab.com, January 31 2017
**Source**: "Postmortem of database outage of January 31", https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/
**What happened**: Replication lag, caused by load spikes, forced a manual secondary rebuild. An engineer deleted 300GB on the primary instead of the secondary. Roughly 5,000 projects, 5,000 comments and 700 users created in a ~7-hour window were lost. The outage lasted ~18 hours.
**Why it failed / concept**: Backups existed but were unusable: the `pg_dump` ran at version 9.2 against a 9.6 server and failed silently, and the alert emails were never delivered (DMARC not configured). There was no disk snapshot and only one primary. Recovery came from a 6-hour-old LVM snapshot copied at ~60Mbps.
**Trade-offs & recovery**: Recovery sequence: copy the staging DB to production, restore webhooks from another instance, bump sequences so IDs are not reused, re-enable services gradually. Fixes: hourly snapshots, Azure disk snapshots, automated backup testing, WAL archiving for PITR. Backup frequency sets RPO; restore throughput sets RTO.
**Observe/measure**: last verified-restorable backup age, restore test pass/fail, restore duration against data size and bandwidth, alert delivery, replication lag before the incident.
**Simulatable?** Yes: a backup component with schedule, success flag and verification, and a restore time = size / throughput. A "silent backup failure" fault, an operator-error fault, and data-loss accounting. It must NOT claim to model human error probabilities or Postgres tooling.

## 3. PostgreSQL docs: streaming and synchronous replication, failover
**Source**: "High Availability, Load Balancing, and Replication", https://www.postgresql.org/docs/current/warm-standby.html
**What happened (documented behavior)**: Streaming replication is asynchronous by default, typically with delay under one second. Synchronous replication waits for standby confirmation before acknowledging a commit (`synchronous_commit = on`, `synchronous_standby_names`, with `FIRST n` or `ANY` quorum). It is "2-safe", and its minimum cost is one round-trip. Promotion uses `pg_promote()`/`pg_ctl promote`. Standbys follow the new timeline if `recovery_target_timeline = 'latest'`.
**Underlying concept**: The durability, latency and availability trade-off. The `remote_write` mode weakens the guarantee. Lag diagnosis separates sent, received, flushed and replayed LSN: a gap at "sent" means primary load, at "received" means network, and at "replayed" means a slow standby. Hot-standby query conflicts occur when replay conflicts with running queries.
**Trade-offs & recovery**: Sync mode stalls writes if the standby is unavailable, unless a quorum with spare standbys is configured. Async can lose the lag window on failover. Cascading replication reduces primary fan-out.
**Observe/measure**: lag in bytes and seconds at each stage, commit latency by mode, write availability when a standby is down, data lost on failover.
**Simulatable?** Yes: a replication mode (async, sync-1, quorum), lag stages (network vs apply), commit latency, and promotion choosing the most-advanced replica. It must NOT claim exact WAL or LSN semantics.

## 4. PostgreSQL docs: continuous archiving and PITR
**Source**: "Continuous Archiving and Point-in-Time Recovery", https://www.postgresql.org/docs/current/continuous-archiving.html
**What happened (documented behavior)**: A base backup plus archived WAL segments lets you replay to a target (`recovery_target_time`, XID, LSN or named point). The target must be after the base backup ends. Each recovery creates a new timeline so history is not overwritten. WAL segments are normally 16MB, and all WAL since the base backup must be retained.
**Underlying concept**: PITR protects against logical errors (a dropped table), which replicas cannot, because they replay the mistake. RTO = restore base + replay WAL volume. RPO = the archive interval, or zero if streamed.
**Trade-offs & recovery**: More frequent base backups give shorter replay but cost more storage. A gap in the WAL archive breaks recoverability past that point.
**Observe/measure**: archive lag, WAL volume since the last base backup, restore plus replay time, and an actual restore drill.
**Simulatable?** Yes: a backup interval, WAL accumulation, and recovery time = restore + replay. A bad-write fault at time T with recovery to T-epsilon, and an archive-gap fault. It must NOT claim real restore speeds.

## 5. PostgreSQL docs: WAL reliability
**Source**: "Reliability", https://www.postgresql.org/docs/current/wal-reliability.html
**What happened (documented behavior)**: Committed data must pass the OS cache, controller cache and drive cache to be durable. Write-back caches without battery backup can lose "committed" data on power loss. `full_page_writes` guards against partial page writes, and WAL records carry CRC-32C checksums.
**Underlying concept**: Durability claims depend on the whole storage stack, and crash recovery replays the log. Acknowledging a write before it is durable trades safety for latency.
**Trade-offs & recovery**: Fsync cost against the loss window. Crash recovery time grows with the amount of WAL to replay.
**Observe/measure**: commit latency with and without fsync, and restart time after a crash as a function of WAL since the last checkpoint.
**Simulatable?** Partially: a "durable ack" flag, a crash fault that loses unflushed writes, and recovery delay proportional to log size. It must NOT claim hardware cache behavior or checksum detection.

## 6. Amazon Aurora replicas and failover
**Source**: "Replication with Amazon Aurora", https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html
**What happened (documented behavior)**: Up to 15 replicas share one cluster volume with the writer. Replica lag is "usually much less than 100 milliseconds" and grows with write rate. If the writer fails, a reader is promoted, with "a brief interruption during which read and write requests... fail". With no replicas, the cluster is unavailable while the instance recovers. Some versions restart a replica that loses contact with the writer for more than 60 seconds.
**Underlying concept**: Shared storage makes replication cheap and promotion faster than rebuilding. Compute failover is separated from storage durability.
**Trade-offs & recovery**: Replicas serve double duty as read capacity and failover targets. The docs recommend the same instance class and different AZs for failover targets. Write failures during the failover window need client retries.
**Observe/measure**: failover duration seen by the client, error rate in the window, replica lag against write rate, read distribution across replicas.
**Simulatable?** Yes: a writer plus N readers, a promotion timer, a write-error window, and lag that rises with write load. It must NOT claim Aurora's specific timings: the page gives none for failover.

## 7. Amazon RDS read replicas and Multi-AZ
**Source**: "Working with DB instance read replicas", https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html; "Multi-AZ DB instance deployments", https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html
**What happened (documented behavior)**: Read replicas are asynchronous and can serve stale data. They can be promoted, and RDS does not autoscale them. A Multi-AZ standby is synchronous in another AZ and cannot serve reads, with "increased write and commit latency" versus Single-AZ.
**Underlying concept**: Two different tools. A standby gives availability and durability. A replica gives read scale and disaster recovery, with a staleness cost.
**Trade-offs & recovery**: Sync costs write latency. Async scales reads but returns stale reads and can lose data when promoted. Replicas must be added manually, so scaling reads is slow.
**Observe/measure**: write latency Multi-AZ vs single, replica lag, stale-read rate, read share offloaded from the primary.
**Simulatable?** Yes: a standby that serves no reads, replicas that do with lag, and manual scale-out with a provisioning delay. A read-your-writes violation counter. It must NOT claim a failover time for Multi-AZ: the page gives no number.

## 8. Amazon RDS Proxy: connection exhaustion and failover
**Source**: "RDS Proxy concepts and terminology", https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.howitworks.html
**What happened (documented behavior)**: The proxy pools and multiplexes connections per transaction, which "reduces the chance of 'too many connections' errors". "Pinning" disables multiplexing for a session. During failover it keeps idle client connections, queues requests while the writer is unavailable, and avoids DNS propagation and caching delays. Only in-flight transactions or statements are cancelled.
**Underlying concept**: Database connections cost memory and CPU, so connection count is a finite resource. Failover and reconnect storms amplify connection pressure.
**Trade-offs & recovery**: A pool adds a hop and a queue. Pinning erodes the benefit. Queuing during failover trades errors for latency.
**Observe/measure**: open connections vs limit, pool wait time, pinned-session share, errors during failover, reconnect rate after failover.
**Simulatable?** Yes: a max-connections limit, a pool with multiplexing, a queue during failover, and a reconnect storm fault. It must NOT claim real per-connection memory costs.

Source count: 8 pages across 7 blocks.

## Challenge seeds
1. **The silent safety net.** A growing product's nightly dump job reports success. A bad deploy corrupts a table mid-afternoon. Symptoms: rows missing, replicas identical to the primary. Requirements: restore service with the least data loss. Constraints: fixed budget, limited restore bandwidth. Success: loss under X minutes of writes, restored within Y minutes, backups verified automatically. Valid designs: continuous log archiving, frequent snapshots, delayed replicas, verified restore drills.
2. **The partition at 3am.** Two regions each hold a copy. A 40-second link loss triggers automation. Symptoms: both sides accept writes, then cannot reconcile. Requirements: keep serving, avoid divergence. Constraints: the app is latency-sensitive and cross-region round trips are slow. Success: zero divergent writes, or a bounded and reconcilable count, and recovery under Y minutes. Valid designs: single-writer fencing, quorum, manual promotion for cross-region, or accept bounded loss with reconciliation.
3. **Reads that lie.** Read traffic is offloaded to copies. A write burst lets lag grow. Symptoms: users do not see their own updates. Requirements: preserve freshness for the user's own writes. Constraints: the primary cannot take all reads. Success: stale-read rate under Z% at peak, primary CPU under a cap. Valid designs: read-your-writes routing, lag-aware routing, synchronous copy for hot paths, caching with invalidation.
4. **Failover storm.** The writer dies. Symptoms: the new primary is hit by reconnects and retries, and latency spikes for minutes. Requirements: shorten client-visible downtime. Constraints: a connection limit on the database and a fixed failover detection time. Success: write error window under Y seconds, no connection-limit errors, queue depth bounded. Valid designs: a pooling tier, request queueing, jittered retries, shedding low-priority traffic.
5. **Durable or fast.** A payments-like workload must not lose acknowledged writes, but p99 latency is bounded. Requirements: choose where to wait for durability. Constraints: a cross-zone RTT adds to every commit. Success: zero acknowledged-write loss across a primary crash in the test, p99 under a budget, writes still available with one copy down. Valid designs: synchronous quorum, shared durable storage, a log-first path with async materialization.

## Modeling notes
A replicated-database component should expose:
- **Topology**: primary, N replicas, zone or region per node, and whether a replica can serve reads.
- **Replication mode**: async, sync (1 copy), quorum (k of n). Sync adds RTT to commit latency, and writes stall when the quorum is unreachable.
- **Lag model**: lag grows when write rate exceeds apply rate (backlog = integral of the difference), and drains at the spare apply capacity. Split into network lag and apply lag. Expose lag in seconds and in write count.
- **Failure detection time and promotion time** as separate parameters. Write error window = detection + promotion. Promotion should pick the most-advanced replica, and the data lost is that replica's lag under async.
- **Failover policy**: manual, automatic same-zone, automatic cross-region. Include fencing on or off, since without it a partition produces two primaries and a divergence count.
- **Fault injection**: node crash, partition, slow replica, disk full, backup failing silently, bad-write at time T.
- **Backup / PITR**: snapshot interval, WAL archive on or off, verification on or off, restore throughput. RTO = restore + replay, RPO = time since the last recoverable point.
- **Connections**: max connections, per-connection overhead, pool and multiplex option, pinned fraction, queue during failover, reconnect storm multiplier.
- **Durability flag**: acknowledge before or after flush, and unflushed writes lost on crash.
- **Outputs**: replication lag, stale-read rate, write error rate, data loss count, divergent writes, connections used vs limit, queue depth, time to recover.
- **Honesty rule**: parameters are scenario settings, not vendor guarantees. Do not state vendor failover times beyond what the docs say. Aurora and Multi-AZ docs fetched here give no failover duration.
