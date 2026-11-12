import { defineComponent } from "../../core/define";
import { clamp, mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config {
  replicas: number; replication: string; syncCopies: number; syncRttMs: number; shipLagSec: number;
  readRouting: string; maxStalenessSec: number; writeLocalitySec: number;
  readQps: number; writeQps: number; applyQps: number; queryMs: number;
  maxConnections: number; poolMultiplex: number; queueDuringFailover: boolean; queueLimit: number;
  failover: string; detectSec: number; manualResponseSec: number; promoteSec: number; fencing: boolean;
  dataGB: number; restoreMBps: number; replayQps: number; snapshotIntervalSec: number; walArchive: boolean; backupVerification: boolean; replicaPlacement: string;
  costPerNodeHour: number;
  [k: string]: number | string | boolean;
}

interface Node { up: boolean; backlog: number; unreceived: number }
interface State {
  nodes: Node[]; primary: number;
  downSince: number; promotingUntil: number; promoteTarget: number;
  partitionedSince: number; oldPrimary: number; splitBrain: boolean; fenced: boolean;
  stormUntil: number;
  writesTotal: number; lastGoodSnapshotAt: number; writesAtSnapshot: number; nextSnapshotAt: number;
  corruptAt: number; corruptWrites: number; restoreStartAt: number; restoreUntil: number;
  dataLoss: number; divergent: number; downtimeSec: number;
  queue: number;
  // sampled metrics
  util: number; staleRate: number; writeOk: boolean; conns: number; lagSec: number; stateCode: number; corrupt: boolean; replicasUp: number;
  writeErrRate: number; writeRate: number; isoNode: number;
}

const FAIL = "fail-node", PART = "partition-primary", BAD = "bad-write", BSILENT = "backup-silent-fail";

export default defineComponent<Config, State>({
  kind: "replicated-db",
  version: "1.0.0",
  name: "Replicated database",
  description: "A primary with read replicas: replication lag, stale reads, failover and split-brain, sync/quorum commits, backups and point-in-time recovery.",
  category: "data",
  icon: "database",
  handlesRegionOutage: true,
  ports: [
    { id: "in", direction: "in", label: "Queries", protocols: ["database", "tcp"] },
    { id: "result", direction: "out", label: "Results", protocols: ["database"], hidden: true },
    { id: "cdc", direction: "out", label: "WAL / CDC", protocols: ["cdc"] },
  ],
  defaults: {
    replicas: 2, replication: "async", syncCopies: 1, syncRttMs: 2, shipLagSec: 0.3,
    readRouting: "replicas", maxStalenessSec: 2, writeLocalitySec: 5,
    readQps: 6000, writeQps: 1500, applyQps: 3000, queryMs: 4,
    maxConnections: 300, poolMultiplex: 1, queueDuringFailover: false, queueLimit: 20000,
    failover: "auto", detectSec: 10, manualResponseSec: 300, promoteSec: 15, fencing: true,
    dataGB: 200, restoreMBps: 100, replayQps: 8000, snapshotIntervalSec: 600, walArchive: false, backupVerification: false, replicaPlacement: "same-region",
    costPerNodeHour: 0.35,
  },
  fields: [
    { key: "replicas", label: "Read replicas", type: "number", min: 0, max: 8, step: 1, group: "Topology", help: "A replica is both read capacity and a failover candidate." },
    { key: "replication", label: "Replication mode", type: "select", group: "Replication", options: [
      { value: "async", label: "Async", hint: "Fast commits; replicas lag; failover can lose the lag window" },
      { value: "sync", label: "Synchronous", hint: "Commit waits for copies: no loss, adds latency, stalls if copies are unreachable" },
    ] },
    { key: "syncCopies", label: "Copies that must confirm", type: "number", min: 1, max: 8, step: 1, group: "Replication", showIf: { key: "replication", equals: "sync" }, help: "Quorum-style: any k replicas. Writes stall when fewer than k are reachable." },
    { key: "syncRttMs", label: "Replica round-trip", type: "number", min: 0.1, max: 300, step: 0.1, unit: "ms", group: "Replication", help: "Added to every commit in sync mode (cross-AZ ≈ low ms, cross-region ≫)." },
    { key: "shipLagSec", label: "Log shipping delay", type: "number", min: 0, max: 60, step: 0.1, unit: "s", group: "Replication", showIf: { key: "replication", equals: "async" }, help: "How far behind the primary the log reaches replicas. Writes inside this window are lost if the primary dies (cross-region links are slower)." },
    { key: "applyQps", label: "Replica apply rate", type: "number", min: 100, max: 200000, step: 100, unit: "writes/s", scale: "log", group: "Replication", help: "Lag grows whenever the write rate exceeds this." },
    { key: "replicaPlacement", label: "Replica placement", type: "select", group: "Topology", options: [
      { value: "same-region", label: "Same region", hint: "A regional outage takes down the whole cluster" },
      { value: "other-region", label: "Other region", hint: "Replicas survive a regional outage; remember to set the round-trip and shipping delay" },
    ] },
    { key: "readRouting", label: "Read routing", type: "select", group: "Reads", options: [
      { value: "primary", label: "Primary only", hint: "Always fresh; primary carries all reads" },
      { value: "replicas", label: "Replicas", hint: "Spread reads over replicas; may be stale" },
      { value: "lag-aware", label: "Lag-aware", hint: "Replicas within max staleness, else primary" },
    ] },
    { key: "maxStalenessSec", label: "Max staleness", type: "number", min: 0, max: 60, step: 0.5, unit: "s", group: "Reads", showIf: { key: "readRouting", equals: "lag-aware" } },
    { key: "writeLocalitySec", label: "Read-after-write window", type: "number", min: 0.5, max: 300, step: 0.5, unit: "s", group: "Reads", help: "How soon after a write the same data is read again. Sets how often lag becomes a visible stale read (approximation)." },
    { key: "readQps", label: "Read capacity / node", type: "number", min: 100, max: 500000, step: 100, unit: "qps", scale: "log", group: "Capacity" },
    { key: "writeQps", label: "Write capacity (primary)", type: "number", min: 50, max: 200000, step: 50, unit: "qps", scale: "log", group: "Capacity" },
    { key: "queryMs", label: "Typical query time", type: "number", min: 0.1, max: 1000, step: 0.1, unit: "ms", scale: "log", group: "Capacity" },
    { key: "maxConnections", label: "Max connections (per node)", type: "number", min: 5, max: 20000, step: 5, group: "Connections" },
    { key: "poolMultiplex", label: "Connection pooler multiplexing", type: "number", min: 1, max: 20, step: 1, unit: "×", group: "Connections", help: "1 = clients connect directly. A pooler shares few server connections among many clients." },
    { key: "queueDuringFailover", label: "Queue requests during outages", type: "switch", group: "Connections", help: "Hold requests while the primary is unavailable instead of failing them (adds latency, bounded by the queue limit)." },
    { key: "queueLimit", label: "Outage queue limit", type: "number", min: 100, max: 1e6, step: 100, scale: "log", group: "Connections", showIf: { key: "queueDuringFailover", equals: true } },
    { key: "failover", label: "Failover", type: "select", group: "Failover", options: [
      { value: "auto", label: "Automatic", hint: "Detect, then promote the most up-to-date replica" },
      { value: "manual", label: "Manual", hint: "A human must notice and act" },
    ] },
    { key: "detectSec", label: "Failure detection time", type: "number", min: 1, max: 120, step: 1, unit: "s", group: "Failover", showIf: { key: "failover", equals: "auto" } },
    { key: "manualResponseSec", label: "Operator response time", type: "number", min: 30, max: 3600, step: 30, unit: "s", group: "Failover", showIf: { key: "failover", equals: "manual" } },
    { key: "promoteSec", label: "Promotion time", type: "number", min: 1, max: 300, step: 1, unit: "s", group: "Failover", help: "Time to promote, repoint clients, and re-warm." },
    { key: "fencing", label: "Fence the old primary", type: "switch", group: "Failover", help: "Without fencing, a network partition can leave two primaries accepting writes (split brain)." },
    { key: "snapshotIntervalSec", label: "Snapshot interval", type: "number", min: 60, max: 86400, step: 60, unit: "s", group: "Backup", help: "Sets the data-loss window when restoring from the last snapshot." },
    { key: "backupVerification", label: "Verify backups automatically", type: "switch", group: "Backup", help: "Test that snapshots are restorable. A silently failing backup job is then caught at the next snapshot and replaced by a working method." },
    { key: "walArchive", label: "Continuous log archiving (PITR)", type: "switch", group: "Backup", help: "Archive the write-ahead log so a restore can replay to just before a bad write." },
    { key: "dataGB", label: "Data size", type: "number", min: 1, max: 100000, step: 1, unit: "GB", scale: "log", group: "Backup" },
    { key: "restoreMBps", label: "Restore throughput", type: "number", min: 5, max: 5000, step: 5, unit: "MB/s", scale: "log", group: "Backup" },
    { key: "replayQps", label: "Log replay rate", type: "number", min: 100, max: 500000, step: 100, unit: "writes/s", scale: "log", group: "Backup", showIf: { key: "walArchive", equals: true } },
    { key: "costPerNodeHour", label: "Price per node", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
  ],
  presets: [
    { id: "small-async", label: "Primary + 2 async replicas", version: 1, approximate: true, source: { title: "Illustrative sizing — replace with measurements of your own database" }, builtin: true, values: { replicas: 2, replication: "async" } },
    { id: "ha-sync", label: "Synchronous, 2 replicas (quorum 1)", version: 1, approximate: true, source: { title: "PostgreSQL docs: synchronous replication", url: "https://www.postgresql.org/docs/current/warm-standby.html" }, builtin: true, values: { replicas: 2, replication: "sync", syncCopies: 1 } },
  ],
  faults: [
    { kind: FAIL, label: "Fail a database node", description: "Crash a node. Index 0 is the original primary. (Params: index)" },
    { kind: PART, label: "Partition the primary", description: "Cut the primary off from replicas. Clients can still reach it." },
    { kind: BAD, label: "Bad write / logical corruption", description: "A bad deploy corrupts data; replicas copy it. Needs a restore. (Params: detectSec)" },
    { kind: BSILENT, label: "Backups silently fail", description: "Snapshot jobs stop producing usable backups with no alert." },
  ],
  derived(c) {
    const restoreSec = (c.dataGB * 1024) / c.restoreMBps;
    const detect = c.failover === "auto" ? c.detectSec : c.manualResponseSec;
    return [
      { label: "Write outage if the primary dies", value: c.replicas === 0 ? "until it restarts" : `${detect + c.promoteSec} s`, tone: detect + c.promoteSec > 60 ? "warn" : "ok", help: "Detection + promotion. Reads can continue on replicas." },
      { label: "Data lost on failover", value: c.replication === "sync" ? "none (acked copies)" : `~${c.shipLagSec} s of writes (unshipped log)`, tone: c.replication === "sync" ? "ok" : "warn" },
      { label: "Restore from snapshot", value: `${Math.round(restoreSec / 60)} min`, tone: restoreSec > 3600 ? "bad" : restoreSec > 1200 ? "warn" : "ok", help: "Data size ÷ restore throughput; plus log replay if archiving is on." },
      { label: "Worst-case data loss (restore)", value: c.walArchive ? "writes since the bad write" : `${Math.round(c.snapshotIntervalSec / 60)} min of writes`, tone: c.walArchive ? "ok" : "warn" },
      { label: "Total read capacity", value: `${(c.readQps * (c.readRouting === "primary" ? 1 : 1 + c.replicas)).toLocaleString()} qps` },
    ];
  },
  costPerHour: (c) => (c.replicas + 1) * c.costPerNodeHour * (c.replicaPlacement === "other-region" ? 1.2 : 1), // cross-region transfer
  metrics: [
    { id: "utilization", label: "Utilization", unit: "%" },
    { id: "replicaLagSec", label: "Worst replica lag", unit: "s" },
    { id: "staleReadRate", label: "Stale reads", unit: "%" },
    { id: "writeAvailable", label: "Writes available", unit: "" },
    { id: "dataLoss", label: "Data loss (writes)", unit: "writes" },
    { id: "divergentWrites", label: "Divergent writes (split brain)", unit: "writes" },
    { id: "connections", label: "Connections", unit: "" },
    { id: "queueDepth", label: "Outage queue", unit: "req" },
    { id: "failoverState", label: "State (0 ok, 1 detecting, 2 promoting, 3 restoring)", unit: "" },
    { id: "replicasUp", label: "Replicas up", unit: "" },
    { id: "downtimeSec", label: "Write downtime", unit: "s" },
    { id: "corrupt", label: "Data corrupt", unit: "" },
  ],
  docs: {
    summary: "A relational database cluster: one primary accepts writes, replicas serve reads and stand by for promotion.",
    models: [
      "Replica lag as a backlog that grows when writes exceed the apply rate and drains afterwards",
      "Stale reads from replicas, as a function of lag and how soon written data is re-read",
      "Async vs synchronous (quorum) commit: commit latency, writes stalling when copies are unreachable, data lost on promotion (the unshipped log window)",
      "Promotion must replay the replica's received-but-unapplied log, so a lagging replica takes longer to promote",
      "Failure detection then promotion of the most up-to-date replica; write outage window; reads continue on replicas",
      "Network partition: with fencing the old primary stops; without it both accept writes and diverge",
      "Connection limits (Little's law) with an optional pooler that multiplexes, and a reconnect burst after failover",
      "Optional request queueing during an outage",
      "Snapshots, log archiving (PITR), restore time = data ÷ throughput (+ replay), data lost on restore, and silent backup failure",
    ],
    simplifies: [
      "Capacity is a flat qps per node; no query planning, locks or hot-standby replay conflicts",
      "Replicas are identical; apply rate is a single number",
      "Stale-read probability is an exponential in lag over a configured window, not per-key tracking",
      "Promotion always picks the replica with the smallest backlog; no election protocol or quorum voting on who is primary",
      "Split-brain divergence is counted, not reconciled; the share of clients that reach the old primary is a fault parameter",
      "Restore time ignores network contention and index rebuilds",
      "All timings are scenario inputs, not vendor guarantees",
    ],
    failureScenarios: [
      "Replica lost at peak: survivors overload and lag",
      "Primary lost: write outage for detection + promotion; data loss under async",
      "Partition without fencing: two primaries, divergent writes",
      "Bad write: replicas copy the corruption, so only a restore helps",
      "Backups silently failing until the day they are needed",
      "Connection exhaustion and a reconnect burst after failover",
    ],
    references: [
      { title: "PostgreSQL: high availability, load balancing, replication", url: "https://www.postgresql.org/docs/current/warm-standby.html" },
      { title: "PostgreSQL: continuous archiving and PITR", url: "https://www.postgresql.org/docs/current/continuous-archiving.html" },
      { title: "GitHub: October 21 post-incident analysis", url: "https://github.blog/news-insights/company-news/oct21-post-incident-analysis/" },
      { title: "GitLab: postmortem of database outage of January 31", url: "https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/" },
      { title: "AWS: Aurora replication", url: "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html" },
    ],
  },
  init(c) {
    return {
      nodes: Array.from({ length: c.replicas + 1 }, () => ({ up: true, backlog: 0, unreceived: 0 })), primary: 0,
      downSince: -1, promotingUntil: -1, promoteTarget: -1, partitionedSince: -1, oldPrimary: -1, splitBrain: false, fenced: false, stormUntil: -1,
      writesTotal: 0, lastGoodSnapshotAt: 0, writesAtSnapshot: 0, nextSnapshotAt: c.snapshotIntervalSec,
      corruptAt: -1, corruptWrites: 0, restoreStartAt: -1, restoreUntil: -1, dataLoss: 0, divergent: 0, downtimeSec: 0, queue: 0,
      util: 0, staleRate: 0, writeOk: true, conns: 0, lagSec: 0, stateCode: 0, corrupt: false, replicasUp: c.replicas, writeErrRate: 0, writeRate: 0, isoNode: -1,
    };
  },
  validate: (c, v) => [
    ...(v.incoming.length === 0 ? [{ severity: "info" as const, message: "Nothing queries this database yet" }] : []),
    ...(c.replicas === 0 ? [{ severity: "warn" as const, message: "No replicas: a primary failure means downtime until it restarts, and reads share the primary" }] : []),
    ...(c.replication === "sync" && c.syncCopies > c.replicas ? [{ severity: "error" as const, field: "syncCopies", message: "Required copies exceed the replica count: writes can never commit" }] : []),
    ...(c.replication === "async" && c.replicas > 0 ? [{ severity: "info" as const, message: "Async replication can lose the lag window on failover" }] : []),
    ...(!c.fencing && c.replicas > 0 ? [{ severity: "warn" as const, field: "fencing", message: "No fencing: a partition can create two primaries" }] : []),
    ...(!c.walArchive ? [{ severity: "info" as const, field: "walArchive", message: "Without log archiving, a restore loses everything since the last snapshot" }] : []),
  ],
  tick(ctx, c, s0, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const t = ctx.time, dt = ctx.dt;
    const s: State = { ...s0, nodes: s0.nodes.map((n) => ({ ...n })) };
    const N = c.replicas + 1;
    while (s.nodes.length < N) s.nodes.push({ up: true, backlog: 0, unreceived: 0 });
    s.nodes.length = N;

    // ---- faults -> node status ----
    const failed = new Set<number>();
    let partitioned = false, partitionClientShare = 0.5, badWrite: { detectSec: number } | null = null, backupSilent = false;
    for (const f of ctx.faults) {
      if (f.kind === "region-outage") { if (c.replicaPlacement === "other-region") failed.add(0); else for (let i = 0; i < c.replicas + 1; i++) failed.add(i); continue; }
      if (f.kind === FAIL) failed.add(Number(f.params.index ?? 0));
      else if (f.kind === PART) { partitioned = true; partitionClientShare = Number(f.params.clientShare ?? 0.5); }
      else if (f.kind === BAD) badWrite = { detectSec: Number(f.params.detectSec ?? 600) };
      else if (f.kind === BSILENT) backupSilent = true;
      if (f.kind === BAD && f.justStarted && s.corruptAt < 0) { s.corruptAt = t; s.corruptWrites = s.writesTotal; events.push({ time: t, nodeId: ctx.nodeId, severity: "error", kind: "bad-write", message: "A bad write corrupted data — replicas will copy it" }); }
    }
    s.nodes.forEach((n, i) => { n.up = !failed.has(i); });
    // a partition cuts off whichever node was primary when it began; it does not follow a promotion
    if (partitioned && s.isoNode < 0) s.isoNode = s.primary;
    if (!partitioned) s.isoNode = -1;
    const isolated = (i: number) => partitioned && i === s.isoNode;
    const p = s.primary;
    const primaryUp = s.nodes[p]!.up;
    const primaryReachable = primaryUp && !isolated(p); // as seen by the failover controller

    // ---- failure detection and promotion ----
    const detect = c.failover === "auto" ? c.detectSec : c.manualResponseSec;
    if (!primaryReachable) {
      if (s.downSince < 0) { s.downSince = t; events.push({ time: t, nodeId: ctx.nodeId, severity: "error", kind: "primary-unreachable", message: isolated(p) && primaryUp ? "Primary partitioned from replicas" : "Primary is down" }); }
      if (s.promotingUntil < 0 && t - s.downSince >= detect && c.replicas > 0) {
        let best = -1;
        s.nodes.forEach((n, i) => { if (i !== p && n.up && (best < 0 || n.backlog + n.unreceived < s.nodes[best]!.backlog + s.nodes[best]!.unreceived)) best = i; });
        if (best >= 0) {
          s.promoteTarget = best; s.promotingUntil = t + c.promoteSec + s.nodes[best]!.backlog / c.applyQps; // must replay received log before accepting writes
          if (isolated(p) && primaryUp && c.fencing) s.fenced = true; // fencing cuts the old primary off
          events.push({ time: t, nodeId: ctx.nodeId, severity: "warn", kind: "failover-started", message: `Failover started — promoting replica ${best}` });
        }
      }
    } else if (s.promotingUntil < 0) {
      if (s.downSince >= 0) events.push({ time: t, nodeId: ctx.nodeId, severity: "info", kind: "primary-recovered", message: "Primary reachable again" });
      s.downSince = -1;
    }
    if (s.promotingUntil >= 0 && t >= s.promotingUntil) {
      const target = s.nodes[s.promoteTarget]!;
      const ship = c.replicaPlacement === "other-region" ? Math.max(c.shipLagSec, ctx.regionRttMs / 1000) : c.shipLagSec; // a remote replica is at least a round trip behind
      const lost = c.replication === "sync" ? 0 : target.unreceived + s0.writeRate * ship; // log not yet shipped
      s.dataLoss += lost;
      s.oldPrimary = p;
      s.splitBrain = isolated(p) && primaryUp && !c.fencing;
      s.primary = s.promoteTarget;
      target.backlog = 0; target.unreceived = 0;
      s.promotingUntil = -1; s.downSince = -1; s.stormUntil = t + 10;
      events.push({ time: t, nodeId: ctx.nodeId, severity: lost > 0 ? "error" : "warn", kind: "promoted", message: `Replica ${s.primary} promoted${lost > 0 ? ` — ${Math.round(lost).toLocaleString()} acknowledged writes lost` : ""}${s.splitBrain ? " — SPLIT BRAIN: old primary still accepting writes" : ""}` });
    }
    if (s.splitBrain && !partitioned) { s.splitBrain = false; events.push({ time: t, nodeId: ctx.nodeId, severity: "warn", kind: "partition-healed", message: `Partition healed — ${Math.round(s.divergent).toLocaleString()} divergent writes must be reconciled or discarded` }); }
    if (!partitioned) s.fenced = false;
    const P = s.primary;
    const promoting = s.promotingUntil >= 0;

    // ---- backups / restore ----
    if (t >= s.nextSnapshotAt) {
      s.nextSnapshotAt += c.snapshotIntervalSec;
      if (backupSilent && c.backupVerification) events.push({ time: t, nodeId: ctx.nodeId, severity: "warn", kind: "backup-verify-failed", message: "Backup verification failed — switched to a working backup method and alerted" });
      if ((!backupSilent || c.backupVerification) && s.corruptAt < 0) { s.lastGoodSnapshotAt = t; s.writesAtSnapshot = s.writesTotal; }
    }
    let restoring = s.restoreUntil > t;
    if (s.corruptAt >= 0 && s.restoreStartAt < 0 && badWrite !== null && t >= s.corruptAt + badWrite.detectSec) {
      s.restoreStartAt = t;
      if (!backupSilent && s.lastGoodSnapshotAt >= 0 || s.writesAtSnapshot > 0 || s.lastGoodSnapshotAt > 0) {
        const replay = c.walArchive ? (s.corruptWrites - s.writesAtSnapshot) / c.replayQps : 0;
        const restoreSec = (c.dataGB * 1024) / c.restoreMBps + Math.max(0, replay);
        s.restoreUntil = t + restoreSec;
        // PITR restores to just before the bad write; otherwise to the snapshot.
        s.dataLoss += c.walArchive ? Math.max(0, s.writesTotal - s.corruptWrites) : Math.max(0, s.writesTotal - s.writesAtSnapshot);
        events.push({ time: t, nodeId: ctx.nodeId, severity: "warn", kind: "restore-started", message: `Restoring from ${c.walArchive ? "snapshot + log replay" : "last snapshot"} — ~${Math.round(restoreSec / 60)} min` });
      } else {
        s.restoreUntil = t; s.dataLoss += s.writesTotal;
        events.push({ time: t, nodeId: ctx.nodeId, severity: "error", kind: "no-backup", message: "No usable backup — data permanently lost" });
      }
      restoring = s.restoreUntil > t;
    }
    if (s.corruptAt >= 0 && s.restoreStartAt >= 0 && t >= s.restoreUntil && s.restoreUntil >= 0 && s.corrupt !== false) { /* handled below */ }
    if (s.corruptAt >= 0 && s.restoreStartAt >= 0 && t >= s.restoreUntil) {
      s.corruptAt = -1; s.restoreStartAt = -1; s.restoreUntil = -1; restoring = false;
      s.nodes.forEach((n) => { n.backlog = 0; n.unreceived = 0; });
      events.push({ time: t, nodeId: ctx.nodeId, severity: "info", kind: "restore-complete", message: "Restore complete — service resumed" });
    }
    const corrupt = s.corruptAt >= 0;

    // ---- demand ----
    const reads = m.count * m.readFraction, writes = m.count - reads;
    let dropped = 0;
    const queueOk = c.queueDuringFailover;
    const oldPrimaryAcceptsSplit = s.splitBrain && s.oldPrimary >= 0 && s.nodes[s.oldPrimary]!.up;
    void partitionClientShare;
    const primaryServing = s.nodes[P]!.up && !promoting && !restoring && !(s.fenced && isolated(P));
    // sync commits need enough reachable replicas
    const reachableReplicas = isolated(P) ? 0 : s.nodes.filter((n, i) => i !== P && n.up && !isolated(i)).length;
    const needSync = c.replication === "sync" ? c.syncCopies : 0;
    const writeOk = primaryServing && reachableReplicas >= needSync;
    const readRoutes: number[] = [];
    const eligible = (i: number) => s.nodes[i]!.up && !restoring;
    if (c.readRouting === "primary") { if (primaryServing) readRoutes.push(P); }
    else {
      const lagOf = (i: number) => (s.nodes[i]!.backlog + s.nodes[i]!.unreceived) / c.applyQps;
      s.nodes.forEach((_, i) => { if (i !== P && eligible(i) && !isolated(i) && (c.readRouting === "replicas" || lagOf(i) <= c.maxStalenessSec)) readRoutes.push(i); });
      if (readRoutes.length === 0 && primaryServing) readRoutes.push(P); // fall back to primary
    }

    // ---- outage queue ----
    let wReq = writes, rReq = reads;
    if (s.queue > 0 && writeOk) { const drain = Math.min(s.queue, c.writeQps * dt * 0.5); s.queue -= drain; wReq += drain; }
    const writesBlocked = !writeOk;
    if (writesBlocked && wReq > 0) {
      if (queueOk) { const room = Math.max(0, c.queueLimit - s.queue); const q = Math.min(wReq, room); s.queue += q; dropped += wReq - q; }
      else dropped += wReq;
      wReq = 0;
    }
    if (readRoutes.length === 0 && rReq > 0) {
      if (queueOk) { const room = Math.max(0, c.queueLimit - s.queue); const q = Math.min(rReq, room); s.queue += q; dropped += rReq - q; }
      else dropped += rReq;
      rReq = 0;
    }

    // ---- connections ----
    const rate = (wReq + rReq) / dt;
    const storm = t < s.stormUntil ? 3 : 1;
    const conns = rate * (c.queryMs / 1000) * storm;
    const connCap = c.maxConnections * c.poolMultiplex * Math.max(1, readRoutes.length + (writeOk ? 1 : 0)) / Math.max(1, 1);
    const admit = conns > connCap ? connCap / conns : 1;
    if (admit < 1) { dropped += (wReq + rReq) * (1 - admit); wReq *= admit; rReq *= admit; }

    // ---- capacity: primary time-shares reads+writes; replicas serve reads ----
    const perNodeReads = new Map<number, number>();
    const share = readRoutes.length > 0 ? rReq / readRoutes.length : 0;
    for (const i of readRoutes) perNodeReads.set(i, share);
    let readsServed = 0, writesServed = 0, staleReads = 0, maxUtil = 0;
    for (const i of readRoutes) {
      const reqs = perNodeReads.get(i)!;
      const demand = reqs / c.readQps + (i === P ? wReq / c.writeQps : 0);
      const f = demand > dt ? dt / demand : 1;
      const served = reqs * f;
      dropped += reqs - served; readsServed += served;
      if (i !== P) { const lag = (s.nodes[i]!.backlog + s.nodes[i]!.unreceived) / c.applyQps; staleReads += served * (1 - Math.exp(-lag / c.writeLocalitySec)); }
      maxUtil = Math.max(maxUtil, demand / dt);
    }
    if (wReq > 0) {
      const used = readRoutes.includes(P) ? (perNodeReads.get(P) ?? 0) / c.readQps : 0;
      const room = Math.max(0, dt - used);
      const cap = room * c.writeQps;
      const served = Math.min(wReq, cap);
      dropped += wReq - served; writesServed = served;
      maxUtil = Math.max(maxUtil, (used + served / c.writeQps) / dt);
    }
    // split brain: the isolated old primary keeps accepting a share of client writes that will be lost on reconcile
    if (oldPrimaryAcceptsSplit) { const diverged = writesServed * partitionClientShare; s.divergent += diverged; s.dataLoss += diverged; }

    // ---- replication ----
    const reachable = (i: number) => s.nodes[i]!.up && !isolated(i) && !isolated(P);
    s.writesTotal += writesServed;
    s.nodes.forEach((n, i) => {
      if (i === P) return;
      if (!reachable(i) || !s.nodes[P]!.up) n.unreceived += writesServed; // missed while down/partitioned
      else {
        n.backlog += writesServed + n.unreceived * 0; // new writes arrive
        const catchup = n.unreceived; if (catchup > 0) { n.backlog += catchup; n.unreceived = 0; }
      }
      const apply = n.up && reachable(i) ? c.applyQps * dt : 0;
      n.backlog = Math.max(0, n.backlog - apply);
      if (corrupt) { /* replicas copy corruption; nothing to do but keep flowing */ }
    });
    const lagSec = Math.max(0, ...s.nodes.map((n, i) => (i === P ? 0 : (n.backlog + n.unreceived) / c.applyQps)));

    // ---- output ----
    const served = readsServed + writesServed;
    const base = c.queryMs / Math.max(0.05, 1 - Math.min(0.95, maxUtil) * 0.9);
    const rtt = c.replicaPlacement === "other-region" ? Math.max(c.syncRttMs, ctx.regionRttMs) : c.syncRttMs; // replicas in another region cost at least the round trip
    const syncLat = c.replication === "sync" && m.count > 0 ? (writesServed / Math.max(1e-9, served)) * rtt : 0;
    const queueWait = queueOk && s.queue > 0 ? (s.queue / (c.writeQps * 0.5)) * 1000 : 0;
    const writeFraction = served > 0 ? writesServed / served : 0;
    const outbound = [{ port: "result", count: served, latencyMs: m.latencyMs + base + syncLat + queueWait, readFraction: 1 - writeFraction }] as { port: string; count: number; latencyMs: number; readFraction: number }[];
    if ((ctx.outEdges.cdc?.length ?? 0) > 0 && writesServed > 0) outbound.push({ port: "cdc", count: writesServed, latencyMs: 0, readFraction: 0 });

    const stateCode = restoring ? 3 : promoting ? 2 : s.downSince >= 0 ? 1 : 0;
    if (!writeOk) s.downtimeSec += dt;
    return {
      state: {
        ...s, queue: s.queue, util: maxUtil, staleRate: served > 0 ? staleReads / served : 0, writeOk, conns, lagSec, stateCode, corrupt,
        replicasUp: s.nodes.filter((n, i) => i !== P && n.up).length, writeErrRate: wReq + writes > 0 ? (writes - writesServed) / Math.max(1e-9, writes) : 0, writeRate: primaryServing && writeOk ? s0.writeRate * 0.98 + (writesServed / dt) * 0.02 : s0.writeRate, isoNode: s.isoNode,
      },
      outbound, dropped, events,
    };
  },
  sample: (_c, s) => ({
    utilization: clamp(s.util, 0, 1), replicaLagSec: s.lagSec, staleReadRate: s.staleRate, writeAvailable: s.writeOk ? 1 : 0, dataLoss: s.dataLoss, divergentWrites: s.divergent,
    connections: s.conns, queueDepth: s.queue, failoverState: s.stateCode, replicasUp: s.replicasUp, downtimeSec: s.downtimeSec, corrupt: s.corrupt ? 1 : 0,
  }),
});
