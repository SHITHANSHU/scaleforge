# Modeling decisions

Short ADR-style log. Each entry: what we model, what we deliberately don't, and why. Debate them in PRs.

1. **Flow, not messages.** Ticks move rates and queue depths. Items carry only count, mean latency and read fraction. Per-key behavior (cache hits, partition skew, Bloom filters) is analytic or sampled. *Why:* keeps 50-node graphs at hundreds× real time (measured ~330× in `golden.test.ts`).
2. **One tick of delay per edge.** Every edge hands flow to the next tick, so cycles work and node order never matters. At the default 10 ms tick this adds latency not represented in the latency sum.
3. **Open-loop load only.** Closed-loop users, retries and think time are not modeled yet.
4. **Outflow on an unconnected port completes the request.** Lets terminal components (hit ports, DB results) end a path without sink nodes. Components should declare such ports `hidden`.
5. **Presets are approximate and live with their component.** No shipped number is presented as exact without a source; the UI shows ≈ and the source. Moving presets to a shared package was rejected to keep components isolated.
6. **Redis hit ratio is Zipf coverage × policy factor × TTL factor × warmth.** Real LRU/LFU run in the Eviction lab, not per request in the engine. LRU/LFU/volatile-ttl differ by fixed factors.
7. **Kafka topic and one consumer group are one node.** Per-partition lag, key skew, retention loss, rebalance pause. No ISR/replication internals.
8. **EC2 credits follow the T2 standard model** (earn/hour, spend per vCPU-minute). T3 unlimited mode is not modeled. Network is a flat sustained limit.
9. **RabbitMQ queues are aggregated** into one backlog; routing is by multiplicity, not key matching (the Routing lab does real matching).
10. **Debezium models snapshot → streaming, lag and WAL growth,** not schema changes or offset rewinds.
11. **Bloom filter runs for real** on sampled keys; filters above 4M bits are scaled down proportionally.
12. **Autoscaling wraps the EC2 model by composition** (`autoscaling-group` imports `ec2`), as the pattern for derived components.
13. **Grading is in-browser and deterministic.** Criteria use worst-case over the judged window (max for `<`, min for `>`), so a transient spike fails a challenge.
14. **Docs are in-app,** generated from registry metadata, instead of a separate Astro/VitePress site: a new component gets its page for free.

## Phase 3 additions

15. **Failure feedback.** Drops, kills and client timeouts are reported to the edges that fed the failing node and flow upstream one tick later; async boundaries (Kafka, RabbitMQ, Debezium) stop the propagation. A component that handles failures itself (retry, requeue, cache fall-back) returns `recovered`, which removes them from user-visible errors. This is what lets retry storms, circuit breakers and fail-open behave like the real thing. Simplification: failures are attributed proportionally to inbound edges, with no per-request identity.
16. **A dead end is an error.** Flow leaving an unconnected output only completes a request if the port is hidden/terminal or the component is a declared `sink` (service endpoints, brokers). Otherwise it is dropped. Before this a design that connected nothing scored perfectly.
17. **Regions are failure domains.** A boundary containing a component is its region; a `kill-node` on the boundary takes its components down unless the component declares `handlesRegionOutage` (stores that span regions). `regionRttMs` is added to cross-region edges. Components in two regions don't share a hidden control plane: failover is modelled by each component, not by the engine.
18. **Duplicates travel with the flow.** `dupFraction` rides along (carried automatically by the engine when a component doesn't set it). Timeouts followed by retries, and redelivery after a rebalance, create duplicates; an idempotency store absorbs them within its window. Exactly-once is never claimed: only effectively-once at a boundary.
19. **Async-commit data loss is the unshipped log, not the apply backlog.** `replicated-db` loses `shipLagSec × write rate` on async promotion; a lagging replica instead takes longer to promote (it replays received log first).
20. **Partitions isolate a node, not a role.** After promotion the partition keeps isolating the old primary (otherwise promotion would flap).
21. **Open-ended grading** is deterministic simulation over public + hidden scenarios with author-defined criteria; hard criteria gate passing, soft criteria give partial credit, budgets use peak spend, unknown metrics never pass, and a score is capped below the pass mark while a must-have fails.
22. **Pricing is a gameplay constraint**, so components carry simple, editable per-hour prices (clearly approximate). Components without a price (e.g. the CDN's real bandwidth cost) are underpriced; challenges that depend on cost lock prices with `kindLocked`.
23. **Latency is a flow mean per tick.** Flows merge at every node, so percentiles are over per-tick means weighted by volume, not over individual requests: real tail latency is understated (a retried request's wait is averaged with its neighbours). Retries do carry the accumulated backoff wait, and timeouts are judged on the same mean.
24. **Grading guards.** A scenario is invalid if under 40% of offered traffic completes end to end (parked/discarded work must not look healthy); locked fixed nodes are compared on their full effective config; cross-region replicas pay at least the scenario's round trip in commit latency and ship delay; unknown criterion scenarios are reported; settle-time direction is inferred from the metric name (`availab`, `throughput`, `goodput`).
