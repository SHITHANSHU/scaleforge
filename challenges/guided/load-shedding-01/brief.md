# Shed load before it queues

Demand (1,600 req/s) is above capacity (1,000 req/s). Without protection the backlog grows and every request becomes slow.

Add a component so served requests stay fast (p99 under 500 ms) while at least 60% are served.

**Concepts:** load shedding, queue age, goodput vs throughput.
