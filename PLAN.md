# System Design Simulator — Frontend Plan

Nov 11, 2026 · @Shithanshu

## Overview

We build a browser-only, open source simulator where backend engineers design an architecture, drive load through it, and watch it break. Everything runs client-side: no accounts, no servers, free static hosting.

The audience is mid, senior and staff engineers. That sets the bar: behavior must be realistic enough that experienced people recognize real failure modes (consumer lag, CPU credit exhaustion, cache stampedes, replication lag), and every number must be visible and editable.

Three principles guide every decision:

- **Simulate behavior, not software.** We model rates, queues, limits and failure rules. We never run real Kafka, Redis or RabbitMQ.
- **Run real algorithms where they are cheap.** Bloom filters, LRU/LFU eviction, consistent hashing, rate limiters and partitioners run for real in the browser.
- **Assumptions are data.** Every throughput, latency and capacity figure lives in an editable, cited preset file, labeled approximate.

## Tech stack

React + TypeScript + Vite, with the simulation in a Web Worker, is the core. Each choice below favors contributor familiarity and a zero-server deploy.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | Shared types between UI, engine and challenge files |
| Build | Vite + pnpm workspaces | Fast dev loop, simple monorepo |
| UI framework | React 18 | Largest contributor pool |
| Canvas / graph editor | React Flow (@xyflow/react) | Nodes, edges, handles, minimap out of the box |
| State | Zustand + Immer | Small, works well with undo/redo |
| Worker bridge | Comlink | Typed RPC to the sim worker |
| Charts | uPlot (live time series), Recharts (summary) | uPlot handles thousands of points at 60 fps |
| Styling | Tailwind CSS + Radix UI primitives | Accessible inspectors, dialogs, sliders |
| Code / config editor | Monaco or CodeMirror 6 | Edit presets and challenge JSON |
| Validation | Zod | Validate designs, presets, challenges on import |
| Storage | IndexedDB via Dexie | Local saves, no account |
| Sharing | lz-string (URL hash), GitHub Gist API | Share without a backend |
| Testing | Vitest, Playwright | Engine unit tests, UI end-to-end |
| Docs | Astro Starlight or VitePress | Component and challenge docs |
| Hosting | GitHub Pages or Netlify | Free, static |

Rust/WASM stays out of v1. Revisit only if profiling shows the engine loop can't hold real-time speed on 50+ node graphs.

## Repo structure

A pnpm monorepo keeps the engine independent of React, so it can later run in Node, a CLI, or a serverless function unchanged.

```
sysdesign-sim/
├── apps/
│   ├── web/                 # React app: canvas, inspector, dashboards
│   └── docs/                # Component + challenge docs site
├── packages/
│   ├── engine/              # Pure TS simulation core (no DOM, no React)
│   │   ├── core/            # clock, scheduler, graph, routing, RNG
│   │   ├── components/      # ec2, lb, redis, kafka, rmq, debezium, db, ws...
│   │   ├── algorithms/      # bloom, lru, lfu, consistent-hash, token-bucket
│   │   └── metrics/         # histograms, percentiles, ring buffers
│   ├── worker/              # Web Worker wrapper around engine (Comlink)
│   ├── schema/              # Zod schemas: design, preset, challenge, scenario
│   └── presets/             # Instance types, broker/DB defaults, with sources
├── challenges/              # Community challenges as JSON + markdown brief
│   ├── kafka-consumer-lag/
│   ├── cache-stampede/
│   └── ...
└── tools/
    └── challenge-lint/      # CI check: every challenge is valid and solvable
```

The one hard rule: `packages/engine` may not import from `apps/` or any browser API. CI enforces it with a lint boundary rule.

## Simulation engine design

The engine is a fixed-step, flow-based simulator: each tick moves request *rates* and queue *depths* through the graph, not individual messages. Individual items are sampled only where they matter (a Bloom filter lookup, a cache key, a Kafka message key for partitioning).

### Core concepts

- **Clock.** Fixed tick (default 10 ms simulated). A speed multiplier runs 1x to 1000x; pause and step-one-tick for debugging.
- **Graph.** Nodes are components; edges carry a traffic class (HTTP, message, CDC event, WS frame) plus network latency and an optional bandwidth cap.
- **Flow.** Each tick a node receives an inbound rate per traffic class, decides how much it can process, queues or drops the rest, and emits outbound rates.
- **Queues.** Every node with buffering has an explicit queue: depth, capacity, overflow policy (drop, reject, backpressure upstream).
- **Latency.** Each node contributes service time (from a distribution, not a constant) plus queueing delay derived from depth / drain rate. End-to-end latency is summed along the request path; p50/p95/p99 come from per-tick histograms.
- **Determinism.** A seeded RNG makes every run reproducible. Same design + scenario + seed = same result, which challenge grading depends on.

### Component interface

```ts
interface SimComponent<Config, State> {
  kind: string;                         // "kafka-topic", "ec2", "redis"
  defaults: Config;                     // pulled from presets
  init(config: Config): State;
  tick(ctx: TickContext, state: State, inbound: Inflow[]): TickResult<State>;
  metrics(state: State): MetricSample;  // what the dashboard plots
  validate?(config: Config, graph: GraphView): Issue[]; // design-time warnings
}

interface TickResult<S> {
  state: S;
  outbound: Outflow[];                  // per edge, per traffic class
  dropped: number;
  events: SimEvent[];                   // "rebalance started", "credits exhausted"
}
```

New components are added by implementing this interface plus a preset and a docs page. That keeps community contributions small and reviewable.

### Failure injection

Users can schedule faults on a timeline: kill a node, add network latency to an edge, partition a broker, fill a disk, trigger a Kafka rebalance, flush a cache. Faults are part of a scenario, so challenges can include them.

### Performance budget

- Engine runs in a dedicated Web Worker; the UI never blocks.
- Worker posts metric snapshots at 10–20 Hz, not every tick.
- Metrics are kept in fixed-size ring buffers (e.g. last 10 min at 100 ms resolution per series).
- Target: 50-node graph at 100x speed on a mid-range laptop.

## Component catalog

Each component exposes the knobs engineers actually tune and models the failure modes they actually hit. Throughput figures come from `packages/presets` and are approximate until calibrated against public benchmarks.

| Component | Key config | Behavior modeled | Failure modes it teaches |
| --- | --- | --- | --- |
| Client / traffic source | RPS, pattern, key distribution | Open-loop vs closed-loop load, Zipf hot keys | Retry storms, thundering herd |
| Load balancer | Algorithm (round robin, least conn, consistent hash), health checks | Request distribution, failover | Uneven load, slow health checks, sticky-session hotspots |
| EC2 instance | Type (t2.nano / micro / small / medium, t3, m5, c5), count, per-request CPU cost | vCPU capacity, memory, network limits; T-family CPU credits with baseline (t2.micro \~10%) and burst | Fine for 20 minutes then throttled; memory pressure; noisy neighbor |
| Autoscaling group | Min/max, metric, cooldown, warm-up | Scale-out delay, warm-up period | Scaling too late, flapping |
| App service | Worker threads, connection pool size, timeouts, retries | Thread and pool saturation, queueing | Pool exhaustion, cascading timeouts |
| Redis (cache) | Memory cap, eviction policy, TTL, ops/sec ceiling, cluster shards | Single-threaded throughput, real LRU/LFU eviction on sampled keys, hit ratio | Cache stampede, hot key, eviction churn, cold start |
| Redis Pub/Sub | Channels, subscribers | Fire-and-forget fan-out | Offline subscribers lose messages; slow subscriber buffer limits |
| Redis Streams | Consumer groups, MAXLEN | Persistent log, pending entries list | Unacked PEL growth, stream trimming data loss |
| Redis Bloom filter | Expected items n, false-positive target p (derives m, k) | Real Bloom filter on sampled keys; observed vs theoretical FP rate | Overfilling past n, no deletes, FP cost on downstream DB |
| Kafka topic | Partitions, replication factor, retention, partitioner | Per-partition throughput and ordering, key hashing | Partition skew from hot keys, retention-based data loss |
| Kafka consumer group | Consumers, processing rate, max.poll.records, commit mode | Partition assignment, lag per partition, rebalance pauses | Lag growth when input > consumption, idle consumers beyond partition count, rebalance storms, duplicate processing |
| RabbitMQ | Exchange type (direct, topic, fanout, headers), queues, prefetch, ack mode, DLX, TTL, queue length limit | Routing, consumer prefetch effects, memory watermark flow control | Unbounded queue growth, publisher blocked by flow control, poison messages, redelivery loops |
| Debezium (CDC) | Source DB, snapshot mode, connector throughput | Snapshot then streaming phases, CDC event lag | WAL/binlog growth when connector lags, snapshot overload, schema change breakage |
| Relational DB (Postgres/MySQL) | Instance size, max connections, read replicas, indexes | Read/write capacity, replica lag, lock contention approximation | Connection exhaustion, replica read-after-write staleness, write amplification from indexes |
| NoSQL (DynamoDB-style) | Partition count, RCU/WCU, on-demand vs provisioned | Per-partition throughput limits | Hot partition throttling |
| WebSocket gateway | Max connections per node, memory per conn, heartbeat interval | Long-lived connection capacity, fan-out cost | Reconnect storms after deploy, memory exhaustion, uneven connection spread |
| CDN / edge cache | Hit ratio, TTL | Origin offload | Cache purge sends full load to origin |
| Rate limiter | Algorithm (token bucket, sliding window), limits | Real algorithm on request stream | Burst vs sustained limits, distributed limiter drift |

v1 ships a subset (see Roadmap). Each row becomes one file in `packages/engine/components` plus a docs page.

## Load testing and traffic patterns

A load test is a **scenario**: a traffic profile, a key distribution, optional faults, and a duration in simulated time. Scenarios are JSON, so users can save, share and put them in challenges.

### Traffic profiles

- **Constant** — steady RPS baseline.
- **Ramp** — linear increase to find the breaking point.
- **Step** — sudden jumps (e.g. 1k → 10k RPS) to test autoscaling and warm-up.
- **Spike** — short burst (flash sale, push notification fan-out).
- **Diurnal** — daily sine wave, compressed in time.
- **Soak** — long, steady run to expose slow leaks (credit exhaustion, retention, WAL growth).
- **Replay** — upload a CSV of timestamp + RPS (or timestamp + key) from real logs. This is how users test with their own data.

### Request mix and keys

- Read/write ratio per endpoint, payload size distribution.
- Key distribution: uniform, Zipf (configurable skew), or a single hot key. This drives cache hit ratio, Kafka partition skew and DB hot partitions.
- Closed-loop mode (N virtual users with think time) vs open-loop mode (fixed arrival rate). Showing how they differ under overload is itself a lesson.

### Auto-find limits

A "find my ceiling" button runs a ramp until a chosen SLO breaks (e.g. p99 > 300 ms or error rate > 1%) and reports the max sustainable RPS and the first component to saturate.

## Metrics, visualization and diagnostics

The canvas itself is the first dashboard: nodes change color with utilization, edges thicken with throughput, and queues show a fill bar. Users should see the bottleneck before opening a single chart.

### Live metrics

- **Global:** throughput, error rate, p50/p95/p99 latency, cost per hour (from instance presets).
- **Per node:** utilization, queue depth, drops, plus component-specific series — Kafka lag per partition, Redis hit ratio and evictions, RMQ ready vs unacked messages, EC2 CPU credit balance, DB connections in use, Debezium lag and WAL size.
- **Per edge:** throughput and added latency.

### Diagnostics

- **Bottleneck detector.** After each run, rank nodes by saturation and name the first one to hit its limit.
- **Event timeline.** Engine events ("rebalance started", "credits exhausted", "memory watermark hit", "replica lag > 5 s") on a shared time axis under the charts, so cause lines up with effect.
- **Request trace.** Sample one simulated request and show its path with time spent per hop, like a mini distributed trace.
- **Design lint.** Static warnings before running: "8 consumers but 6 partitions — 2 will be idle", "Pub/Sub used for jobs that must not be lost", "no DLQ on this queue".
- **Run comparison.** Overlay two runs (before and after a change) on the same charts.

## Challenges system

Challenges are folders in the repo: a `challenge.json` (starting design, locked nodes, scenario, success criteria) plus a `brief.md`. Contributors add challenges by PR; CI checks each one is valid and has a passing reference solution.

### Schema (sketch)

```json
{
  "id": "kafka-consumer-lag-01",
  "title": "Orders pipeline is falling behind",
  "level": "senior",
  "tags": ["kafka", "consumer-group", "throughput"],
  "starterDesign": "./starter.design.json",
  "locked": ["producer", "orders-topic.partitions"],
  "budget": { "maxCostPerHour": 4.0 },
  "scenario": "./scenario.json",
  "seed": 42,
  "criteria": [
    { "metric": "kafka.lag.max", "op": "<", "value": 10000, "after": "60s" },
    { "metric": "e2e.p99", "op": "<", "value": 500 },
    { "metric": "ordering.violations", "op": "==", "value": 0 }
  ],
  "hints": ["How many consumers can one partition have?"],
  "referenceSolution": "./solution.design.json"
}
```

Grading runs in the browser with the fixed seed, so results are reproducible. Locks and budgets stop the trivial answer ("just add 50 instances").

### Starter challenge set

| Level | Challenge | Concept tested |
| --- | --- | --- |
| Mid | Cache-aside for a read-heavy API | Hit ratio, TTL, DB offload |
| Mid | Pick the right RMQ exchange | Direct vs topic vs fanout routing |
| Mid | Bloom filter for username availability | Sizing n/p, FP cost on DB |
| Senior | Consumer lag: input 50k/s, consumers 8k/s each, 6 partitions locked | Partition ceiling, batching, faster processing, scaling partitions |
| Senior | Cache stampede on hot key expiry | Request coalescing, jittered TTL, early refresh |
| Senior | Flash sale on t2.medium fleet | CPU credits, autoscaling warm-up, queue-based load leveling |
| Senior | Poison message loop in RMQ | DLX, retry with backoff, max redeliveries |
| Staff | Outbox + Debezium for order events | Dual-write problem, CDC lag, WAL growth under connector failure |
| Staff | 1M WebSocket connections, survive a deploy | Connection draining, reconnect jitter, fan-out via Pub/Sub vs Kafka |
| Staff | Hot partition at 10x Black Friday | Key salting, partition strategy, cost vs latency trade-off |
| Staff | Multi-region read path | Replica lag, read-your-writes, cache invalidation |

After passing, users see the reference solution and a short write-up of trade-offs. Staff-level challenges should have more than one valid solution, judged on cost and latency together.

## Persistence and sharing

Everything a user creates is stored locally and shared through files or links, so no account or server is ever required.

| Need | How | Limit |
| --- | --- | --- |
| Autosave designs and runs | IndexedDB (Dexie), versioned schema with migrations | Per browser, per device |
| Backup / move devices | Export and import a `.sdsim.json` bundle (design + scenarios + presets) | Manual |
| Quick share | Design compressed with lz-string into the URL hash | Roughly 30–50 node designs before URLs get unwieldy |
| Large share | Save to a GitHub Gist with the user's own token, load by Gist ID | Needs a GitHub account |
| Challenge progress | IndexedDB, exportable | Not synced |
| Embed | `?embed=1` read-only mode for blogs and docs | Static view plus replay |

Every saved file carries a `schemaVersion`. Zod validates imports, and old versions run through migrations so shared links don't break as the app evolves.

## UI layout and key screens

The main workspace follows a familiar IDE layout so engineers feel at home: palette on the left, canvas in the center, inspector on the right, metrics docked at the bottom.

### Workspace regions

- **Left: component palette.** Grouped by category (compute, cache, messaging, data, network). Drag onto the canvas.
- **Center: canvas.** React Flow graph, live utilization coloring, edge throughput labels, minimap, groups (VPC / region / AZ boxes).
- **Right: inspector.** Config for the selected node with sliders and presets, derived values shown live (e.g. Bloom filter m and k from n and p; max useful consumers from partitions), and a "why this matters" note linking to docs.
- **Bottom: run panel.** Scenario picker, play / pause / step / speed, live charts, event timeline, bottleneck report.
- **Top bar:** design name, undo/redo, save, share, challenge mode toggle.

### Screens

1. **Home** — templates (URL shortener, chat, payments, news feed), recent designs, challenge catalog.
2. **Workspace** — the editor above.
3. **Challenge mode** — workspace plus brief, locked nodes, budget meter, criteria checklist that ticks live.
4. **Playgrounds** — focused single-concept labs: Bloom filter lab, eviction policy lab, Kafka partition / consumer lab, RMQ routing lab. These are the fastest way to learn one primitive deeply.
5. **Preset editor** — view and edit instance types and component defaults, with sources.
6. **Docs** — one page per component: how it is modeled, what is simplified, real-world references.

Keyboard shortcuts, dark mode and a responsive read-only view on mobile are in scope; full editing on mobile is not.

## Testing and open source practices

The engine is the product, so it gets the strictest testing; trust from senior engineers depends on its numbers being explainable.

### Testing

- **Engine unit tests (Vitest).** Each component tested in isolation against known math: an M/M/1 queue's latency vs utilization, Bloom filter FP rate vs formula, lag growth = (input − capacity) × time.
- **Golden-run tests.** Fixed design + scenario + seed → snapshot of key metrics. Any engine change that shifts them must be explained in the PR.
- **Challenge CI.** Every challenge validates against the schema, its reference solution passes, and its starter design fails.
- **UI tests (Playwright).** Build a design, run, share link, reload from link.
- **Performance check.** Benchmark a 50-node graph in CI and fail on regressions over 20%.

### Open source setup

- MIT or Apache-2.0 license.
- `CONTRIBUTING.md` with three paths: add a challenge (no code), add a preset or source (no code), add a component (TypeScript).
- Issue templates for "model is unrealistic", with a field for the real-world source.
- Good-first-issue labels on challenges and presets to grow contributors.
- A modeling-decisions log (ADR-style) explaining each simplification, so reviewers can debate them in the open.

## Risks and open questions

The biggest risk is credibility: if experienced engineers see unrealistic numbers once, they leave. Most mitigations target that.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Unrealistic throughput numbers | Senior users stop trusting results | Cited presets, editable values, "approximate" labels, calibration issues |
| Over-modeling (trying to emulate Kafka fully) | Scope explodes, v1 never ships | Model only behaviors that change a design decision; ADR log for each simplification |
| Engine too slow for large graphs | Laggy UI, short runs | Worker isolation, flow-based ticks, profiling budget; WASM only if needed |
| Too few challenges at launch | Low retention | Ship 10 strong ones; make adding challenges a no-code PR |
| URL shares break after schema changes | Dead links in blogs | `schemaVersion` + migrations, golden tests on old fixtures |
| Single maintainer burnout | Project stalls | Clear module boundaries so contributors own components |

### Open questions

- Which components make the v1 cut beyond Kafka, Redis and EC2: RabbitMQ or Postgres first?
- Should cost modeling use real AWS on-demand prices (needs periodic updates) or relative units?
- How deep should DB modeling go: connection and throughput limits only, or also index and lock behavior?
- Is a later, optional AI design-review feature worth a single serverless proxy?

## Roadmap and status

Updated only after verification. Last gate: `pnpm check` (typecheck + lint + 245 tests) green; UI exercised in Chrome DevTools (catalog filters, challenge start with fixed items and restricted palette, evaluation in a worker, results view, labs, docs/presets; no console errors).

### Phase 1–2 (foundation, product) — done
Engine (deterministic flow simulation, registry, contracts, presets, validation), web workstation (canvas, inspector from registry metadata, worker, live overlays, execution dock, persistence, sharing, labs, presets editor, docs), 7 guided exercises. See git history/this file's earlier sections in docs.

### Phase 3 — research, ecosystem, real-world challenges — done
| Area | Status |
| --- | --- |
| Research (4 files, ~35 fetched primary sources) → `docs/research/01–04`, synthesis and roadmap in `00-synthesis.md` | **Done** |
| Engine capabilities: failure feedback upstream, client retries/timeouts, `recovered`, duplicate tracking, regions as failure domains (`handlesRegionOutage`, `regionRttMs`), `kind:` fault targets, async boundaries, dead ends are errors, `pulses` traffic | **Done** (tests in `resilience.test.ts`) |
| New components (19 total): `replicated-db`, `quorum-kv`, `search-cluster`, `app-service`, `api-gateway`, `idempotency-store` (+ load-balancer failover/DNS, Kafka duplicates/requeue, RabbitMQ requeue, pricing) | **Done** |
| Challenge system v2: declarative public statement, separate grading (weights, hard/soft, partial credit, hidden scenarios, settle-time), resources/locks/budget, evaluation in a worker | **Done** |
| 10 open-ended challenges across 8 categories and 3 levels (blank canvas, no solution in the statement; reference + alternatives pass, plausible wrong designs fail — CI-checked) | **Done** |
| Guided exercises kept separate from engineering challenges; 8 labs (adds retries/metastable failure, hashing, replication/failover, quorums) | **Done** |
| Catalog: search, level/category filters, progress; challenge panel: statement, constraints, scenario picker, budget, optional hints, results with hidden-scenario reveal, write-up | **Done** |
| Docs: `docs/challenge-authoring.md`, `docs/decisions.md` (15–22), CONTRIBUTING updates | **Done** |

### Pending / deferred
- **Components:** columnar OLAP ("too many parts"), object storage (prefix throttling), time-series, service mesh, lock/lease service. Not added: separate CockroachDB/MongoDB/ScyllaDB/DynamoDB nodes (covered by `quorum-kv`/`replicated-db`; see synthesis).
- **Playgrounds:** leader election / fencing tokens, gossip, vector clocks, saga/outbox.
- **Challenges:** hot-key vs consistency (quorum-kv), columnar ingest stability, object-store hot prefix, and more from the research seeds.
- **Product:** Playwright E2E suite; request-trace view; run comparison; "find my ceiling"; CodeMirror/Monaco JSON editor; per-component pricing realism; closed-loop load.
- **A11y follow-ups:** drawers on narrow screens; live-region announcements for saturation/down transitions.
- **Unverified against live services:** GitHub Gist save/load.
- **Honest limits:** simulations are teaching models, not production predictors. Vendor timings are not asserted; sources record which numbers the documentation actually gives.
