# Orders pipeline is falling behind

Input is **50k msg/s**. The topic has **6 partitions (locked)**; each consumer handles 8k msg/s. Lag keeps growing.

Get max-partition lag under 10,000 after 60 s with errors under 1%.

**Concepts:** partition ceiling, idle consumers, processing speed.
