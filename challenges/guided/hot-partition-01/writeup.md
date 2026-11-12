Salt the hot key (key + random suffix) so it spreads across partitions; consumers re-aggregate downstream. Trade-off: you lose strict per-key ordering for that key.
