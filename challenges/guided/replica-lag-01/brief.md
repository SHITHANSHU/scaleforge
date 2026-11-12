# Reads that show old data

An app reads from replicas to offload the primary. Replicas apply writes at 300/s but the primary takes about 600 writes/s, so lag grows and users miss their own updates.

Get stale reads under 5% **without changing the replica count or apply rate**.

**Concepts:** replication lag, read routing, freshness vs primary load.
