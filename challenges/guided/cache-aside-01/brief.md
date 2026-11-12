# Cache-aside for a read-heavy API

A catalog API serves **4,000 requests/s, 95% reads** straight from a small Postgres. The database is saturated and requests are failing.

Add a cache so the database stays under 80% utilization with errors under 1%. The database is locked: you can't just buy a bigger one.

**Concepts:** hit ratio, TTL, DB offload.
