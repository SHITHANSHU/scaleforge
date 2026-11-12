# Survive a node loss without going stale

A replicated key-value store has RF=3 and currently reads/writes at ALL, so one dead node makes many operations fail. Reads/writes at ONE would stay available but can be stale.

Choose consistency levels so operations stay available with a node down **and** reads are never stale.

**Concepts:** quorums, R + W > RF, availability vs consistency.
