import { defineComponent } from "../../core/define";
import { clamp, mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config {
  nodes: number; rf: number; readCL: string; writeCL: string; nodeQps: number; baseMs: number; hotKeyShare: number;
  compactionEverySec: number; compactionSec: number; compactionSlowdownPct: number; hintWindowSec: number; hintReplayQps: number; staleWindowSec: number;
  costPerNodeHour: number; spreadRegions: number; [k: string]: number | string;
}
interface State { util: number[]; hot: number; avail: number; stale: number; hints: number; lost: number; lat: number; consistent: number; downNodes: number; wasDown: number; compacting: number }

const need = (cl: string, rf: number) => (cl === "one" ? 1 : cl === "quorum" ? Math.floor(rf / 2) + 1 : rf);
/** P(at least k of a random rf-node replica set are alive) when `down` of `n` nodes are down. */
function pAtLeast(n: number, rf: number, down: number, k: number): number {
  const up = n - down;
  const comb = (a: number, b: number) => { if (b < 0 || b > a) return 0; let r = 1; for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1); return r; };
  let p = 0;
  for (let live = k; live <= rf; live++) p += (comb(up, live) * comb(down, rf - live)) / comb(n, rf);
  return p;
}

export default defineComponent<Config, State>({
  kind: "quorum-kv",
  version: "1.0.0",
  name: "Quorum KV store",
  description: "A Dynamo/Cassandra-style replicated key-value store: replication factor, consistency levels, hot partitions, hinted handoff and compaction.",
  category: "data",
  icon: "network",
  handlesRegionOutage: true,
  ports: [
    { id: "in", direction: "in", label: "Requests", protocols: ["database", "tcp"] },
    { id: "result", direction: "out", label: "Results", protocols: ["database"], hidden: true },
  ],
  defaults: { nodes: 6, rf: 3, readCL: "quorum", writeCL: "quorum", nodeQps: 8000, baseMs: 3, hotKeyShare: 0, compactionEverySec: 120, compactionSec: 15, compactionSlowdownPct: 40, hintWindowSec: 180, hintReplayQps: 1500, staleWindowSec: 5, costPerNodeHour: 0.4, spreadRegions: 1 },
  fields: [
    { key: "nodes", label: "Nodes", type: "number", min: 3, max: 60, step: 1, group: "Cluster" },
    { key: "rf", label: "Replication factor", type: "number", min: 1, max: 7, step: 1, group: "Cluster", help: "Every key lives on this many nodes." },
    { key: "spreadRegions", label: "Regions spanned", type: "number", min: 1, max: 5, step: 1, group: "Cluster", help: "Nodes are spread evenly. A regional outage removes one region's share of nodes; with 1 region it takes down the whole cluster. Mind the round-trip your edges and consistency level add." },
    { key: "readCL", label: "Read consistency level", type: "select", group: "Consistency", options: [{ value: "one", label: "One", hint: "Fast; may read stale" }, { value: "quorum", label: "Quorum", hint: "Majority of replicas" }, { value: "all", label: "All", hint: "Every replica; any node down = unavailable" }] },
    { key: "writeCL", label: "Write consistency level", type: "select", group: "Consistency", options: [{ value: "one", label: "One", hint: "Fast; may lose on failure" }, { value: "quorum", label: "Quorum", hint: "Majority of replicas" }, { value: "all", label: "All", hint: "Every replica; any node down = unavailable" }] },
    { key: "nodeQps", label: "Throughput per node", type: "number", min: 100, max: 500000, step: 100, unit: "ops/s", scale: "log", group: "Capacity" },
    { key: "baseMs", label: "Replica latency", type: "number", min: 0.2, max: 200, step: 0.2, unit: "ms", scale: "log", group: "Capacity" },
    { key: "hotKeyShare", label: "Hot-key share", type: "number", min: 0, max: 1, step: 0.01, group: "Workload", help: "Fraction of operations that target one key. They all land on the same replica set, however large the cluster." },
    { key: "staleWindowSec", label: "Read-after-write window", type: "number", min: 0.5, max: 300, step: 0.5, unit: "s", group: "Workload", help: "How soon after a write the same key is read. Sets how often inconsistency shows as a stale read (approximation)." },
    { key: "compactionEverySec", label: "Compaction cycle", type: "number", min: 10, max: 3600, step: 10, unit: "s", group: "Background work" },
    { key: "compactionSec", label: "Compaction duration", type: "number", min: 1, max: 600, step: 1, unit: "s", group: "Background work" },
    { key: "compactionSlowdownPct", label: "Capacity lost while compacting", type: "number", min: 0, max: 90, step: 5, unit: "%", group: "Background work" },
    { key: "hintWindowSec", label: "Hint retention", type: "number", min: 10, max: 3600, step: 10, unit: "s", group: "Recovery", help: "Writes meant for a down node are held this long; beyond it they are dropped and need repair." },
    { key: "hintReplayQps", label: "Hint replay rate", type: "number", min: 10, max: 100000, step: 10, unit: "ops/s", scale: "log", group: "Recovery" },
    { key: "costPerNodeHour", label: "Price per node", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
  ],
  presets: [],
  faults: [{ kind: "fail-node", label: "Fail a node", description: "Crash a node. (Params: index; nodes 0..rf-1 hold the hot key.)" }, { kind: "slow-node", label: "Slow node", description: "Node runs at reduced speed. (Params: index, factor)" }],
  costPerHour: (c) => c.nodes * c.costPerNodeHour,
  derived(c) {
    const r = need(c.readCL, c.rf), w = need(c.writeCL, c.rf);
    const strong = r + w > c.rf;
    return [
      { label: "Consistency", value: strong ? `strong (R+W=${r + w} > RF=${c.rf})` : `eventual (R+W=${r + w} ≤ RF=${c.rf})`, tone: strong ? "ok" : "warn", help: "Overlapping read and write sets guarantee a read sees the latest acknowledged write." },
      { label: "Node failures tolerated", value: `reads ${c.rf - r}, writes ${c.rf - w}`, tone: Math.min(c.rf - r, c.rf - w) === 0 ? "bad" : "ok", help: "Per replica set, before that operation type becomes unavailable." },
      { label: "Hot-key ceiling", value: `${Math.round((c.nodeQps * c.rf) / Math.max(1, c.rf)).toLocaleString()} ops/s`, tone: c.hotKeyShare > 0 ? "warn" : "ok", help: "A single key can use at most one replica set's capacity regardless of cluster size." },
    ];
  },
  metrics: [
    { id: "utilization", label: "Busiest node", unit: "%" },
    { id: "hotUtil", label: "Hot replica set", unit: "%" },
    { id: "availability", label: "Operations satisfiable", unit: "%" },
    { id: "staleReadRate", label: "Stale reads", unit: "%" },
    { id: "hintBacklog", label: "Hints queued", unit: "ops" },
    { id: "dataLoss", label: "Dropped hints (needs repair)", unit: "ops" },
    { id: "nodesDown", label: "Nodes down", unit: "" },
    { id: "latencyMs", label: "Latency contribution", unit: "ms" },
  ],
  docs: {
    summary: "A leaderless replicated store. Each key lives on RF nodes; an operation succeeds when enough replicas respond for its consistency level.",
    models: [
      "Availability of reads and writes given live replicas and the consistency level (hypergeometric over random replica sets)",
      "Strong vs eventual consistency from R + W vs RF, with stale reads after node trouble",
      "Skewed keys: a hot key overloads one replica set while the cluster looks idle",
      "Hinted handoff: writes for a down node queue as hints, replay load on recovery, and expire after the retention window",
      "Periodic compaction reducing node capacity",
      "Slow nodes dragging latency for operations that wait on them",
    ],
    simplifies: [
      "Keys are modelled as uniform plus one configurable hot key; no token ranges, vnodes or rebalancing",
      "Replica latency is an average with a load factor; no per-request order statistics",
      "No read repair, anti-entropy or tombstones; stale reads are an approximation from a configured window",
      "No gossip or failure-detector delay: a node is down or up",
      "Coordinator overhead and cross-datacenter consistency levels are not modeled",
    ],
    failureScenarios: ["CL=ALL with one node down is unavailable", "One hot key saturates a replica set while other nodes idle", "Hints expire during a long outage, leaving replicas inconsistent", "Compaction latency spikes", "A slow node degrades latency for quorum reads that include it"],
    references: [
      { title: "Dynamo: Amazon's highly available key-value store (SOSP '07)", url: "https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf" },
      { title: "Apache Cassandra: Dynamo-style architecture", url: "https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html" },
      { title: "Discord: how Discord stores trillions of messages", url: "https://discord.com/blog/how-discord-stores-trillions-of-messages" },
    ],
  },
  init: (c) => ({ util: new Array(c.nodes).fill(0), hot: 0, avail: 1, stale: 0, hints: 0, lost: 0, lat: c.baseMs, consistent: 1, downNodes: 0, wasDown: 0, compacting: 0 }),
  validate: (c, v) => [
    ...(c.rf > c.nodes ? [{ severity: "error" as const, field: "rf", message: "Replication factor exceeds node count" }] : []),
    ...(v.incoming.length === 0 ? [{ severity: "info" as const, message: "Nothing sends requests here yet" }] : []),
    ...(need(c.readCL, c.rf) + need(c.writeCL, c.rf) <= c.rf ? [{ severity: "info" as const, message: "R + W ≤ RF: reads can be stale (eventual consistency)" }] : []),
    ...(c.hotKeyShare > 0.1 ? [{ severity: "warn" as const, field: "hotKeyShare", message: "Hot key: one replica set carries a disproportionate share" }] : []),
  ],
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const N = c.nodes, rf = Math.min(c.rf, N);
    const down = new Set<number>(), slow = new Map<number, number>();
    let regionActive = false;
    for (const f of ctx.faults) {
      if (f.kind === "region-outage") { regionActive = true; continue; }
      if (f.kind === "fail-node") down.add(Number(f.params.index ?? 0));
      if (f.kind === "slow-node") slow.set(Number(f.params.index ?? 0), Math.max(0.05, Number(f.params.factor ?? 0.3)));
    }
    // Region-aware placement: each replica set has one replica per region, so a regional outage costs each set ceil(rf/regions) replicas.
    const regionNodes = regionActive ? (c.spreadRegions <= 1 ? N : Math.ceil(N / c.spreadRegions)) : 0;
    const regionLoss = regionActive ? (c.spreadRegions <= 1 ? rf : Math.ceil(rf / c.spreadRegions)) : 0;
    for (let i = N - regionNodes; i < N; i++) down.add(i); // region's nodes sit at the end of the ring (hot-key nodes 0..rf-1 are in other regions)
    const nDown = [...down].filter((i) => i < N).length;
    const rN = need(c.readCL, rf), wN = need(c.writeCL, rf);
    const reads = m.count * m.readFraction, writes = m.count - reads;
    const hot = c.hotKeyShare;
    const hotLive = Array.from({ length: rf }, (_, i) => !down.has(i)).filter(Boolean).length - (regionActive && c.spreadRegions > 1 ? regionLoss : 0);

    // availability: uniform keys vs the hot key (stuck on nodes 0..rf-1)
    const pu = (k: number) => {
      if (!regionActive) return pAtLeast(N, rf, nDown, k);
      const rfRem = rf - regionLoss, nRem = N - regionNodes, extraDown = [...down].filter((i) => i < N - regionNodes).length;
      return rfRem < k || nRem < rfRem ? 0 : pAtLeast(nRem, rfRem, extraDown, k);
    };
    const hotOk = (k: number) => (hotLive - (regionActive && c.spreadRegions <= 1 ? hotLive : 0) >= k ? 1 : 0);
    const availR = (1 - hot) * pu(rN) + hot * hotOk(rN), availW = (1 - hot) * pu(wN) + hot * hotOk(wN);
    const okReads = reads * availR, okWrites = writes * availW;
    let dropped = reads - okReads + (writes - okWrites);

    // compaction capacity (nodes compact out of phase)
    const phase = (i: number) => ((ctx.time + (i * c.compactionEverySec) / N) % c.compactionEverySec) < c.compactionSec;
    // load per node: reads touch rN replicas, writes touch all rf
    const baseWork = (okReads * rN + okWrites * rf) / ctx.dt; // replica-ops/s
    const perNodeUniform = ((1 - hot) * baseWork) / Math.max(1, N - nDown); // survivors take over the dead nodes' share
    const hotWorkPerReplica = (hot * (okReads * rN + okWrites * rf)) / ctx.dt / Math.max(1, rf);
    const hintReplay = s.hints > 0 && nDown === 0 ? Math.min(s.hints / ctx.dt, c.hintReplayQps) : 0;
    const util: number[] = [];
    let compacting = 0, served = 1;
    for (let i = 0; i < N; i++) {
      const comp = phase(i) ? 1 - c.compactionSlowdownPct / 100 : 1; if (phase(i)) compacting++;
      const cap = c.nodeQps * comp * (slow.get(i) ?? 1);
      const load = down.has(i) ? 0 : perNodeUniform + (i < rf ? hotWorkPerReplica : 0) + hintReplay / N;
      util.push(down.has(i) ? 0 : load / cap);
    }
    const maxUtil = Math.max(...util);
    if (maxUtil > 1) served = 1 / maxUtil;          // overloaded replicas shed proportionally
    const hotUtil = Math.max(...util.slice(0, rf));
    const hotServed = hotUtil > 1 ? 1 / hotUtil : 1;
    const effective = (1 - hot) * Math.min(1, served) + hot * hotServed;
    dropped += (okReads + okWrites) * (1 - effective);

    // hints for writes aimed at down nodes
    let hints = s.hints, lost = s.lost;
    if (nDown > 0) hints += (okWrites * (nDown / N) * rf) ; // writes whose replica set included a down node
    if (nDown === 0 && hints > 0) hints = Math.max(0, hints - hintReplay * ctx.dt);
    if (s.wasDown > 0 && nDown > 0 && ctx.time - s.wasDown > c.hintWindowSec) { lost += hints; hints = 0; events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "hints-expired", message: "Hint window exceeded — missed writes dropped; replicas need repair" }); }
    const wasDown = nDown > 0 ? (s.wasDown > 0 ? s.wasDown : ctx.time) : 0;
    if (nDown > 0 && s.downNodes === 0) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "node-down", message: `${nDown} node(s) down — writes accumulate hints` });

    // staleness: only when reads can miss the latest write (R+W <= RF); worse with recent outages / hint backlog
    const strong = rN + wN > rf;
    const divergenceSec = (hints / Math.max(1, c.hintReplayQps)) + (nDown > 0 ? 2 : 0.2);
    const stale = strong ? 0 : 1 - Math.exp(-divergenceSec / c.staleWindowSec);

    // latency: wait for the rN-th (reads) / wN-th (writes) replica; slow or busy replicas hurt
    const slowest = Math.max(1, ...[...slow.values()].map((f) => 1 / f));
    const util4 = clamp(Math.max(hot > 0 ? hotUtil : 0, ...util) / 1, 0, 0.97);
    const waitFactor = (k: number) => 1 + 0.15 * (k - 1) + (k >= rf ? (slowest - 1) * 0.8 : (slowest - 1) * 0.25);
    const kAvg = (rN * reads + wN * writes) / Math.max(1e-9, reads + writes);
    const wan = c.spreadRegions > 1 && kAvg > 1 ? ctx.regionRttMs : 0; // waiting for a remote replica pays the round trip
    const lat = c.baseMs * waitFactor(kAvg) / (1 - util4 * 0.85) + wan;
    const served2 = okReads * effective + okWrites * effective;
    return {
      state: { util, hot: hotUtil, avail: reads + writes > 0 ? (okReads + okWrites) / (reads + writes) : 1, stale, hints, lost, lat, consistent: strong ? 1 : 0, downNodes: nDown, wasDown, compacting },
      outbound: [{ port: "result", count: served2, latencyMs: m.latencyMs + lat, readFraction: m.readFraction }],
      dropped, events,
    };
  },
  sample: (_c, s) => ({ utilization: clamp(Math.max(0, ...s.util), 0, 1), hotUtil: clamp(s.hot, 0, 1), availability: s.avail, staleReadRate: s.stale, hintBacklog: s.hints, dataLoss: s.lost, nodesDown: s.downNodes, latencyMs: s.lat }),
});
