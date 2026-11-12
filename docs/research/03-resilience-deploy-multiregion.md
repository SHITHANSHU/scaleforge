# Resilience, deployment and multi-region: research for ScaleForge

All sources below were fetched. Figures come from those pages. "Sim" means the ScaleForge flow simulator (instances with capacity, queues, warm-up, health-check delay, killable regions, DNS TTL, retrying clients). Sections marked "Do not claim" list what the sim must not claim.

## 1. Google SRE Book, Addressing Cascading Failures
**Source**: https://sre.google/sre-book/addressing-cascading-failures/
- **Problem**: A failure raises the failure probability of the remaining parts (positive feedback). Example: 1,000 QPS becomes 1,200 QPS on the survivors when a cluster dies.
- **Concept**: Overload leads to resource exhaustion (CPU, memory/GC death spiral, threads, FDs), then health-check failures, then further capacity loss. Cold caches make fresh or restarted tasks less efficient.
- **Trade-offs and recovery**:
  - Keep queues small (the chapter suggests at most 50% of the thread pool) so excess work is rejected early.
  - Shed load with 503s or degrade results.
  - Use randomized exponential backoff, a per-request retry cap, and a service-wide retry budget (example given: 60 retries/min).
  - Propagate deadlines downstream.
  - Overprovision or ramp traffic slowly to cold clusters.
  - Emergency options: add capacity, temporarily disable health checks, drop traffic hard (even to ~1%), drop batch work.
- **Observe**: queue depth, in-flight requests, error rate, per-instance load after a failure, cache hit rate on new tasks, retry fraction.
- **Sim**: Yes. Capacity loss pushes survivors past capacity, queues grow, timeouts trigger retries, goodput collapses. A health check that kills overloaded instances closes the loop.
- **Do not claim**: GC, thread or FD behaviour. Model only an abstract "effective capacity drops when over capacity" curve, and label it an assumption.

## 2. Google SRE Book, Handling Overload
**Source**: https://sre.google/sre-book/handling-overload/
- **Problem**: A backend gets more work than it can serve, and clients retry.
- **Concept**:
  - Per-customer quotas, which may sum to more than total capacity.
  - Client-side adaptive throttling: the client rejects locally once requests exceed K x accepts (K about 2; a lower K is more aggressive).
  - Four criticality tiers (CRITICAL_PLUS, CRITICAL, SHEDDABLE_PLUS, SHEDDABLE), with lower tiers rejected first.
  - Retry budgets: max 3 attempts per request, retries capped at 10% of requests per client.
  - Backends return "don't retry" when most incoming requests are retries.
- **Trade-offs**: Shedding protects goodput but fails some users. Criticality needs consistent labelling. Client throttling needs client cooperation.
- **Observe**: accepts vs requests per client, retry ratio, rejections by tier.
- **Sim**: Yes. Traffic classes with priority, a retry budget, and an accept-ratio throttle are all flow-level.
- **Do not claim**: these K and budget values as universal; they are the book's examples.

## 3. AWS Builders' Library, Using load shedding to avoid overload
**Source**: https://builder.aws.com/content/3Eun1EEyX6p2e3VYNyRLSJzLuMV/using-load-shedding-to-avoid-overload (the aws.amazon.com/builders-library URL returned a 301 to this page)
- **Problem**: Past a threshold, latency rises sharply, clients time out and retry, and the feedback loop makes things worse.
- **Concept**:
  - Goodput (successful, timely responses) vs throughput.
  - The "latency cliff".
  - If median latency equals the client timeout, availability is 50%.
  - Reject excess requests early.
- **Trade-offs**:
  - False positives hurt availability when capacity actually exists.
  - Early rejection is cheap but gives less visibility.
  - Aggressive shedding can stop reactive autoscaling from triggering (the scaling signal disappears).
  - Deadline enforcement across machines is hard.
- **Observe**: client-perceived availability and latency, rejected volume, queue depth and request age at dequeue, the goodput plateau in load tests (push well past the break point).
- **Sim**: Yes. Plot goodput vs offered load, with the shed threshold as a tunable.
- **Do not claim**: an exact latency-vs-utilization law. Pick a documented curve (e.g. queueing) and call it a model.

## 4. AWS Builders' Library, Static stability using Availability Zones
**Source**: https://builder.aws.com/content/3K9SiqiJ369TGkkGzqPM95BuYWI/static-stability-using-availability-zones (301 from aws.amazon.com/builders-library)
- **Problem**: Recovery that depends on a control plane (launching new capacity) fails exactly when you need it.
- **Concept**: Pre-provision enough capacity to lose a whole AZ with no new launches. Active-active: 3 AZs at 66% utilization each, which is 50% overprovisioning. Active-standby: a warm standby in another AZ.
- **Trade-offs**: Cost (idle headroom) and complexity. The page gives 2/3 survival probability for zonal calls and (2/3)^2 = 4/9 for regional-calling-regional chains.
- **Observe**: per-zone utilization, headroom vs the N-1 requirement, failover time with no scale-up.
- **Sim**: Yes. Compare "autoscale after the AZ loss" with "pre-provisioned N-1" on the same zone kill.
- **Do not claim**: that this is the correct choice for every cost profile.

## 5. AWS post-event summary, us-east-1, 7 Dec 2021
**Source**: https://aws.amazon.com/message/12721/
- **Problem**: An automated scaling activity made internal clients open a surge of connections. This congested the devices linking the internal and main networks. Latency and errors caused more retries, which caused more congestion.
- **Concept**: Retry storm / congestion collapse. Real-time monitoring was impaired by the same congestion, so operators relied on logs. Timeline (PST): 7:30 trigger, 9:28 DNS redirected, 2:22 PM devices recovered.
- **Recovery and fixes**: Disabled the triggering scaling activity, added network protections, fixed latent client back-off code, made the status dashboard multi-region.
- **Observe**: connection attempts per second, retry ratio, and whether the monitoring path shares fate with the failing path.
- **Sim**: Yes, as an error-feedback retry amplifier plus a shared-link capacity limit. A "monitoring blind" toggle (delayed or noisy metrics) is also modelable.
- **Do not claim**: any network device internals.

## 6. AWS post-event summary, us-east-1, 19-20 Oct 2025
**Source**: https://aws.amazon.com/message/101925/
- **Problem**: A race condition in DynamoDB's DNS management left an empty DNS record for the regional endpoint. This began at 11:48 PM PDT on Oct 19, and the root cause was identified at 12:38 AM. DNS was restored at 2:25 AM, and customers recovered at ~2:40 AM as cached DNS records expired.
- **Concept**: Dependent systems then cascaded (EC2 lease management, NLB health checks on new instances, Lambda, ECS/EKS). Full EC2 recovery was at 1:50 PM. This was a long tail from backlogs and a recovery-time gap after the root fix.
- **Trade-offs and recovery**:
  - Throttled the recovery (DWFM load, Lambda async work) so recovery itself did not overload.
  - Disabled automatic NLB health-check failover to avoid removing capacity.
  - Relaxed throttles gradually from 11:23 AM.
  - Planned velocity controls on failover capacity limits and queue-depth-based throttling.
- **Observe**: time from root-cause fix to client recovery (cache expiry), backlog drain rate, healthy-instance fraction vs a failover limit.
- **Sim**: Yes. A dependency fails, a client-side DNS cache delays recovery, and a backlog drains under a throttle. Health-check mass-removal is a model parameter (cap on ejected fraction).
- **Do not claim**: the internal mechanics (DWFM, DNS Enactors).

## 7. Cloudflare, 18 Nov 2025 outage
**Source**: https://blog.cloudflare.com/18-november-2025-outage/
- **Problem**: A database permissions change (11:05 UTC) made a query return duplicate rows. This more than doubled a Bot Management feature file and exceeded a 200-feature limit in the proxy, which panicked. Errors began at 11:28.
- **Concept**: A bad config release propagated globally and acts like a bad deploy. Failures fluctuated as different database nodes updated, which looked like an attack. Fix: stop propagation (14:24), push the last good file (14:30), full recovery at 17:06.
- **Trade-offs**: Treat internal config as untrusted input, add global kill switches, and stop error reporting from exhausting resources.
- **Observe**: error rate by version cohort, time to detect, time to roll back.
- **Sim**: Yes. A bad version hits 100% of instances when pushed globally, and the sim can compare staged rollout with big-bang. Flapping can be modelled as nodes alternating between good and bad.
- **Do not claim**: ClickHouse or proxy details.

## 8. Google Cloud incident, 12 Jun 2025
**Source**: https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW
- **Problem**: A new quota-policy code path (added 29 May) had no feature flag and no error handling. A policy with blank fields was replicated globally, causing a null-pointer crash and crash loops in every region. Timeline (PDT): 10:45 change, ~10:55 root cause identified, ~11:35 kill switch fully rolled out, 1:18 PM full recovery.
- **Concept**: Global replication defeats regional isolation, since region boundaries do not help when the bad data is replicated everywhere. Restarting tasks created a herd on Spanner, and recovery in us-central1 took up to 2h40m because there was no randomized exponential backoff.
- **Trade-offs**: A kill switch is fast (about 40 min here) but must already exist. Feature flags and staged data rollout reduce blast radius.
- **Observe**: restart rate, load on the shared dependency during recovery, per-region recovery time.
- **Sim**: Yes. Restarting instances all hit a shared dependency at once. Compare no-backoff, jittered backoff and staggered restart.
- **Do not claim**: Spanner or Service Control internals.

## 9. Kubernetes, Horizontal Pod Autoscaling
**Source**: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/
- **Concept**:
  - Formula: desired = ceil(current x currentMetric / targetMetric).
  - Sync period 15s, tolerance 10%.
  - Scale-down stabilization 300s (the highest recommendation in the window is used), scale-up 0s.
  - Default scale-up can double every 15s.
  - Not-ready pods are excluded from metrics for 30s (initial readiness delay), and the CPU initialization period is 300s.
- **Trade-offs**: A reactive signal lags the load. Warm-up means new pods add no capacity for some time. Stabilization avoids flapping but holds extra capacity.
- **Observe**: metric lag, time-to-capacity (decision to serving), replicas vs demand, flapping count.
- **Sim**: Yes. Decision interval + metric delay + provisioning delay + warm-up ramp + stabilization window, all deterministic.
- **Do not claim**: that these defaults match a cloud provider's autoscaler. Queue-based and predictive scaling are not in this doc, and the docs mention custom and external metrics only generically.

## 10. Kubernetes, Deployments (rolling update) and probes
**Source**: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ and https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- **Concept**:
  - Rolling update uses maxSurge and maxUnavailable (both default 25%), minReadySeconds (default 0) and progressDeadlineSeconds. `kubectl rollout undo` rolls back.
  - Readiness failure removes the pod from Service endpoints without restarting it. Liveness failure restarts it.
  - Probe defaults: period 10s, timeout 1s, failureThreshold 3. Startup probe protects slow starters.
  - Termination: SIGTERM, then a grace period (default 30s), then SIGKILL.
- **Trade-offs**: A faster rollout has a bigger blast radius. A slower one has a longer mixed-version window. Probe thresholds trade false ejections against slow detection (about period x threshold).
- **Observe**: error rate by version, available vs desired capacity during the rollout, time-to-detect a bad version, requests dropped at shutdown.
- **Sim**: Yes. Surge and unavailable limits, readiness delay, health-check delay, and drain time are all flow-level.
- **Do not claim**: canary or blue-green semantics from this source. It documents rolling updates only, and those two strategies come from general practice.

## Challenge seeds
1. **Flash crowd on a cold fleet**
   - Situation: Traffic goes 8x in 2 minutes during a promotion.
   - Symptoms: Latency climbs, then timeouts, then more traffic from retries.
   - Requirements: Keep checkout working.
   - Constraints: Instances take 90s to become useful, and budget is capped.
   - Criteria: Goodput at least 95% of capacity, p99 under target, bounded retry ratio.
2. **Zone loss at peak**
   - Situation: One of three zones disappears.
   - Symptoms: Survivors overload, health checks eject more instances.
   - Requirements: Stay available.
   - Constraints: The scale-up path may be impaired.
   - Criteria: Error rate under X% within Y seconds, cost per hour of the chosen headroom.
3. **Bad release at full rollout**
   - Situation: A new version has a 30% error rate but the checks pass.
   - Symptoms: Errors correlated with version.
   - Requirements: Limit exposure and recover quickly.
   - Constraints: Mixed versions are allowed for at most 30 minutes.
   - Criteria: Time to detect, time to roll back, users affected.
4. **Recovery stampede**
   - Situation: A shared dependency was down for 5 minutes and is back.
   - Symptoms: It falls over again each time it recovers.
   - Requirements: Return to steady state without a second outage.
   - Constraints: Clients are not under your control.
   - Criteria: Peak load on the dependency stays below its capacity, time to drain the backlog.
5. **Region outage with slow client failover**
   - Situation: One region dies, and clients cache resolutions.
   - Symptoms: A share of users keeps hitting the dead region.
   - Requirements: Move users to the other region.
   - Constraints: Capacity in the surviving region is limited and third-party clients ignore hints.
   - Criteria: Time until 99% of traffic is served, surviving-region saturation.
6. **Poisoned global config**
   - Situation: A configuration change is pushed to every region at once.
   - Symptoms: Simultaneous crashes everywhere, restarts loop.
   - Requirements: Contain the damage and recover.
   - Constraints: No manual access to instances for the first 20 minutes.
   - Criteria: Blast radius (% of fleet), time to last-known-good.

For each seed, multiple valid architectures should exist; score on measured criteria, not on one named design.

## Modeling notes
- **Deployment strategies**
  - Rolling: replace instances in batches limited by surge and unavailable (K8s defaults 25%/25%). A new instance joins after warm-up plus readiness delay. Detection takes about check period x failure threshold.
  - Canary: the sim sends x% of flow to the new version. This is a modeling choice, because the fetched docs do not define it.
  - Blue-green: two full fleets with a switch, so double the cost and no mixed window. Also a modeling choice.
  - Bad release: error probability per version. Rollback is a new rollout of the old version, so it takes time too.
- **Autoscaling signals**
  - Reactive: utilization or latency with delay, formula as in HPA, plus the provisioning delay and warm-up ramp.
  - Queue-based: scale on backlog. This is a design choice, not covered by the fetched K8s page.
  - Predictive: a forecast from a known schedule. Do not claim real forecasting accuracy.
  - Shedding can hide the load signal (AWS load shedding article).
- **Circuit breaker and load shedding parameters**
  - Shed: queue cap, max age at dequeue, a criticality tier, and client accept-ratio K (the SRE example is 2).
  - Retries: attempts per request (3 in the SRE example), retry budget (10%), jitter on or off. State clearly that these are examples from one company's book.
  - Circuit breaker: no fetched source gave thresholds, so use trip error rate, open duration and half-open probe share as free, user-visible parameters with no "recommended" values.
- **DNS failover delay**
  - Time to recover is about detection (check period x threshold) + record change + client cache TTL. Per-client cache age is uniform in [0, TTL], so traffic migrates gradually.
  - The Oct 2025 postmortem shows cached DNS records delaying recovery after the fix. The sim must not claim that clients honor TTLs; model a fraction that overshoots as a parameter.
