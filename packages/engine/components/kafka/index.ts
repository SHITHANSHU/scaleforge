import { defineComponent } from "../../core/define";
import { clamp, mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";
import { kafkaPresets } from "./presets";

interface Config {
  partitions: number; replicationFactor: number; retentionHours: number; partitionRate: number; hotKeyShare: number;
  consumers: number; consumerRate: number; maxPollRecords: number; commitMode: string; commitIntervalSec: number; retryOnFailure: boolean; costBaseHour: number; costPerConsumerHour: number; rebalancePauseSec: number; produceLatencyMs: number;
  [k: string]: number | string | boolean;
}
interface State { lag: number[]; weights: number[]; pausedUntil: number; lost: number; consumedRate: number; idle: number; lastConsumers: number; ingest: number; dupPending: number; dupTotal: number; retried: number }

const MAX_P = 256;
const weights = (p: number, hot: number) => Array.from({ length: p }, (_, i) => (i === 0 ? hot + (1 - hot) / p : (1 - hot) / p));

export default defineComponent<Config, State>({
  kind: "kafka",
  sink: true,
  version: "1.0.0",
  name: "Kafka topic + consumer group",
  description: "Partitioned log with one consumer group: per-partition lag, key skew, retention and rebalance pauses.",
  category: "messaging",
  icon: "waypoints",
  ports: [
    { id: "produce", direction: "in", label: "Producers", protocols: ["event-stream", "tcp", "cdc"] },
    { id: "consume", direction: "out", label: "Consumed", protocols: ["event-stream", "message-queue", "http"] },
  ],
  defaults: { partitions: 6, replicationFactor: 3, retentionHours: 168, partitionRate: 10000, hotKeyShare: 0, consumers: 3, consumerRate: 8000, maxPollRecords: 500, commitMode: "auto", commitIntervalSec: 5, retryOnFailure: true, costBaseHour: 0.6, costPerConsumerHour: 0.05, rebalancePauseSec: 5, produceLatencyMs: 5 },
  fields: [
    { key: "partitions", label: "Partitions", type: "number", min: 1, max: MAX_P, step: 1, group: "Topic", help: "Upper bound on useful consumers in a group." },
    { key: "replicationFactor", label: "Replication factor", type: "number", min: 1, max: 5, step: 1, group: "Topic" },
    { key: "retentionHours", label: "Retention", type: "number", min: 1, max: 8760, step: 1, unit: "h", scale: "log", group: "Topic", help: "Consumers lagging past retention lose data." },
    { key: "partitionRate", label: "Per-partition throughput", type: "number", min: 100, max: 200000, step: 100, unit: "msg/s", scale: "log", group: "Throughput" },
    { key: "hotKeyShare", label: "Hot-key share", type: "number", min: 0, max: 1, step: 0.01, group: "Throughput", help: "Fraction of messages sharing one key → all land in one partition." },
    { key: "produceLatencyMs", label: "Produce latency", type: "number", min: 0.5, max: 500, step: 0.5, unit: "ms", group: "Throughput", help: "Grows with replication factor (acks=all)." },
    { key: "consumers", label: "Consumers in group", type: "number", min: 0, max: MAX_P, step: 1, group: "Consumer group" },
    { key: "consumerRate", label: "Processing rate per consumer", type: "number", min: 10, max: 200000, step: 10, unit: "msg/s", scale: "log", group: "Consumer group" },
    { key: "maxPollRecords", label: "max.poll.records", type: "number", min: 1, max: 10000, step: 10, group: "Consumer group", help: "Larger batches raise throughput but lengthen poll intervals." },
    { key: "commitMode", label: "Offset commit", type: "select", group: "Consumer group", options: [{ value: "auto", label: "Auto commit", hint: "Duplicates possible after crash" }, { value: "manual", label: "Manual after processing", hint: "At-least-once" }] },
    { key: "commitIntervalSec", label: "Auto-commit interval", type: "number", min: 0.1, max: 60, step: 0.1, unit: "s", group: "Consumer group", showIf: { key: "commitMode", equals: "auto" }, help: "After a rebalance, consumers resume from the last commit: everything since is processed again (duplicates)." },
    { key: "retryOnFailure", label: "Re-queue when downstream fails", type: "switch", group: "Consumer group", help: "Failed messages go back to the log and are tried again (backpressure) instead of being lost. Needs an idempotent consumer to be safe." },
    { key: "costBaseHour", label: "Cluster base price", type: "number", min: 0, max: 100, step: 0.05, unit: "$/h", group: "Cost" },
    { key: "costPerConsumerHour", label: "Price per consumer", type: "number", min: 0, max: 10, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "rebalancePauseSec", label: "Rebalance pause", type: "number", min: 0, max: 120, step: 1, unit: "s", group: "Consumer group" },
  ],
  asyncBoundary: true,
  costPerHour: (c) => c.costBaseHour + c.consumers * c.costPerConsumerHour,
  presets: kafkaPresets,
  faults: [{ kind: "rebalance", label: "Trigger rebalance", description: "Pause consumption while partitions are reassigned." }],
  derived(c) {
    const active = Math.min(c.consumers, c.partitions);
    const idle = Math.max(0, c.consumers - c.partitions);
    const cap = active * c.consumerRate;
    return [
      { label: "Max useful consumers", value: String(c.partitions), help: "Extra consumers sit idle." },
      { label: "Idle consumers", value: String(idle), tone: idle > 0 ? "bad" : "ok" },
      { label: "Group consumption ceiling", value: `${cap.toLocaleString()} msg/s`, tone: cap > c.partitions * c.partitionRate ? "warn" : "ok" },
      { label: "Topic ingest ceiling", value: `${(c.partitions * c.partitionRate).toLocaleString()} msg/s` },
    ];
  },
  metrics: [
    { id: "utilization", label: "Consumer utilization", unit: "%" },
    { id: "lagTotal", label: "Consumer lag (total)", unit: "msg" },
    { id: "lagMax", label: "Consumer lag (max partition)", unit: "msg" },
    { id: "idleConsumers", label: "Idle consumers", unit: "" },
    { id: "queueDepth", label: "Backlog", unit: "msg" },
    { id: "dataLoss", label: "Retention loss", unit: "msg" },
    { id: "duplicates", label: "Redelivered (duplicates)", unit: "msg" },
    { id: "requeued", label: "Re-queued after failures", unit: "msg" },
  ],
  docs: {
    summary: "A topic and one consumer group. Messages are spread over partitions by key; each partition is read by exactly one consumer.",
    models: ["Per-partition lag and throughput limit", "Hot-key skew concentrating load on one partition", "Partition→consumer assignment; consumers beyond partition count idle", "Retention-based data loss", "Rebalance pause (fault: rebalance)", "Lag growth = (input − capacity) × time"],
    simplifies: ["Topic and consumer group are one node; multiple groups need multiple nodes", "No broker replication internals or ISR shrink", "Batch size only informs derived hints, not throughput yet", "Rebalance is a global pause; no cooperative rebalancing"],
    failureScenarios: ["Lag grows when input exceeds group capacity", "Adding consumers beyond partition count does nothing", "Hot key saturates one partition while others idle", "Rebalance storms pause consumption", "Lag older than retention is lost"],
    references: [{ title: "Kafka consumer group protocol", url: "https://kafka.apache.org/documentation/#intro_consumers" }],
  },
  init: (c) => ({ lag: new Array(c.partitions).fill(0), weights: weights(c.partitions, c.hotKeyShare), pausedUntil: -1, lost: 0, consumedRate: 0, idle: 0, lastConsumers: c.consumers, ingest: 0, dupPending: 0, dupTotal: 0, retried: 0 }),
  validate(c) {
    const out = [];
    if (c.consumers > c.partitions) out.push({ severity: "warn" as const, field: "consumers", message: `${c.consumers} consumers but ${c.partitions} partitions — ${c.consumers - c.partitions} will be idle` });
    if (c.consumers === 0) out.push({ severity: "warn" as const, field: "consumers", message: "No consumers: lag grows until retention drops data" });
    if (c.commitMode === "auto") out.push({ severity: "info" as const, field: "commitMode", message: "Auto commit can lose or duplicate messages on crash" });
    return out;
  },
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const P = c.partitions;
    const lag = s.lag.length === P ? [...s.lag] : Array.from({ length: P }, (_, i) => s.lag[i] ?? 0);
    const w = weights(P, c.hotKeyShare); // cheap, and picks up live hot-key edits
    let pausedUntil = s.pausedUntil;
    let dupPending = s.dupPending, retried = 0;
    if (ctx.faults.some((f) => f.kind === "rebalance" && f.justStarted) || c.consumers !== s.lastConsumers) {
      pausedUntil = ctx.time + c.rebalancePauseSec;
      dupPending += c.commitMode === "auto" ? s.consumedRate * c.commitIntervalSec : Math.min(s.consumedRate, c.maxPollRecords); // work since the last commit is replayed
      events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "rebalance", message: `Rebalance started — consumption paused ${c.rebalancePauseSec}s` });
    }

    // produce: each partition accepts up to partitionRate; excess is rejected back to producers
    let dropped = 0;
    for (let i = 0; i < P; i++) {
      const arr = m.count * w[i]!;
      const accepted = Math.min(arr, c.partitionRate * ctx.dt);
      dropped += arr - accepted;
      lag[i]! += accepted;
    }

    // consume: partition i belongs to consumer i % active; each consumer has a shared budget
    const active = Math.min(c.consumers, P);
    let consumed = 0;
    if (ctx.time >= pausedUntil && active > 0) {
      for (let k = 0; k < active; k++) {
        const owned: number[] = [];
        for (let i = k; i < P; i += active) owned.push(i);
        const want = owned.reduce((a, i) => a + lag[i]!, 0);
        const take = Math.min(want, c.consumerRate * ctx.dt);
        if (want > 0) for (const i of owned) { const d = (lag[i]! / want) * take; lag[i]! -= d; consumed += d; }
      }
    }

    // retention: drop backlog older than retention (estimated from drain rate of ingest)
    let lost = s.lost;
    const lostBefore = lost;
    const ingest = s.ingest * 0.995 + (m.count / ctx.dt) * 0.005;
    const retained = Math.max(1, ingest) * c.retentionHours * 3600;
    for (let i = 0; i < P; i++) {
      const limit = Math.max(retained * w[i]!, 1);
      if (lag[i]! > limit) { lost += lag[i]! - limit; lag[i] = limit; }
    }
    if (lost > s.lost && s.lost === 0) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "retention-loss", message: "Consumers fell behind retention — data lost" });

    // replayed messages are redelivered once consumption resumes (bounded by consumer capacity)
    let emitDup = 0;
    if (ctx.time >= pausedUntil && dupPending > 0 && active > 0) { emitDup = Math.min(dupPending, c.consumerRate * active * ctx.dt * 0.5); dupPending -= emitDup; }
    // downstream failures: re-queue (backpressure) or lose
    let failedDown = 0;
    for (const id of ctx.outEdges.consume ?? []) failedDown += ctx.feedback(id).failed;
    if (failedDown > 0 && c.retryOnFailure) { retried = failedDown; for (let i = 0; i < P; i++) lag[i]! += (failedDown * w[i]!); }
    const total = lag.reduce((a, b) => a + b, 0);
    const consumeRate = consumed / ctx.dt;
    const waitMs = consumeRate > 0 ? (total / consumeRate) * 1000 : total > 0 ? 3_600_000 : 0;
    const lat = m.latencyMs + c.produceLatencyMs * (1 + 0.3 * (c.replicationFactor - 1)) + clamp(waitMs, 0, 3_600_000);
    return {
      state: { lag, weights: w, pausedUntil, lost, consumedRate: consumeRate, idle: Math.max(0, c.consumers - P), lastConsumers: c.consumers, ingest, dupPending, dupTotal: s.dupTotal + emitDup, retried: s.retried + retried },
      outbound: [
        { port: "consume", count: consumed, latencyMs: lat, readFraction: m.readFraction, dupFraction: 0 },
        ...(emitDup > 0 ? [{ port: "consume", count: emitDup, latencyMs: lat, readFraction: m.readFraction, dupFraction: 1 }] : []),
      ],
      dropped: dropped + (lost - lostBefore), events, recovered: retried,
    };
  },
  sample: (c, s) => ({
    utilization: active(c) > 0 ? s.consumedRate / (active(c) * c.consumerRate) : 0,
    lagTotal: s.lag.reduce((a, b) => a + b, 0), lagMax: Math.max(0, ...s.lag), idleConsumers: s.idle,
    queueDepth: s.lag.reduce((a, b) => a + b, 0), dataLoss: s.lost, duplicates: s.dupTotal, requeued: s.retried,
  }),
});
function active(c: Config) { return Math.min(c.consumers, c.partitions); }
