import { defineComponent } from "../../core/define";
import { mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config {
  exchange: string; queues: number; matchedQueues: number; consumers: number; consumerRate: number; prefetch: number; ackMode: string;
  dlx: boolean; maxRedeliveries: number; poisonRate: number; messageTtlSec: number; queueLimit: number; watermarkMsgs: number; rttMs: number; costBaseHour: number; costPerConsumerHour: number;
  [k: string]: number | string | boolean;
}
interface State { good: number; poison: number; ready: number; unacked: number; dlq: number; blocked: boolean; expired: number; rate: number; util: number; wasBlocked: boolean }

const perConsumerRate = (c: Config) => Math.min(c.consumerRate, c.prefetch / (c.rttMs / 1000));

export default defineComponent<Config, State>({
  kind: "rabbitmq",
  sink: true,
  version: "1.1.0",
  name: "RabbitMQ",
  description: "Exchange + queues with consumer prefetch, ack modes, dead-lettering and memory-watermark flow control.",
  category: "messaging",
  icon: "shuffle",
  ports: [
    { id: "publish", direction: "in", label: "Publishers", protocols: ["message-queue", "tcp"] },
    { id: "consume", direction: "out", label: "Consumed", protocols: ["message-queue", "http"] },
    { id: "dlx", direction: "out", label: "Dead letters", protocols: ["message-queue"] },
  ],
  defaults: { exchange: "direct", queues: 1, matchedQueues: 1, consumers: 4, consumerRate: 2000, prefetch: 20, rttMs: 4, ackMode: "manual", dlx: false, maxRedeliveries: 3, poisonRate: 0, messageTtlSec: 0, queueLimit: 100000, watermarkMsgs: 400000, costBaseHour: 0.4, costPerConsumerHour: 0.05 },
  fields: [
    { key: "exchange", label: "Exchange type", type: "select", group: "Routing", options: [
      { value: "direct", label: "Direct", hint: "Exact routing key → one queue" },
      { value: "topic", label: "Topic", hint: "Pattern match → N queues" },
      { value: "fanout", label: "Fanout", hint: "Copy to every bound queue" },
      { value: "headers", label: "Headers", hint: "Match on headers → N queues" },
    ] },
    { key: "queues", label: "Bound queues", type: "number", min: 1, max: 50, step: 1, group: "Routing" },
    { key: "matchedQueues", label: "Queues matched per message", type: "number", min: 1, max: 50, step: 1, group: "Routing", help: "Topic and headers exchanges: how many bound queues a typical message matches." },
    { key: "consumers", label: "Consumers (total)", type: "number", min: 0, max: 500, step: 1, group: "Consumers" },
    { key: "consumerRate", label: "Rate per consumer", type: "number", min: 1, max: 100000, step: 10, unit: "msg/s", scale: "log", group: "Consumers" },
    { key: "prefetch", label: "Prefetch count", type: "number", min: 1, max: 2000, step: 1, scale: "log", group: "Consumers", help: "Unacked messages allowed in flight per consumer. Too low starves fast consumers; too high hoards." },
    { key: "rttMs", label: "Ack round-trip", type: "number", min: 0.1, max: 200, step: 0.1, unit: "ms", group: "Consumers", help: "Network + processing time per ack. With prefetch it caps per-consumer throughput at prefetch ÷ RTT." },
    { key: "ackMode", label: "Ack mode", type: "select", group: "Consumers", options: [{ value: "manual", label: "Manual", hint: "At-least-once" }, { value: "auto", label: "Auto", hint: "Messages lost if consumer dies" }] },
    { key: "poisonRate", label: "Poison messages", type: "number", min: 0, max: 1, step: 0.001, group: "Failures", help: "Fraction that always fail processing." },
    { key: "dlx", label: "Dead-letter exchange", type: "switch", group: "Failures", help: "Without a DLX, failed messages are requeued forever." },
    { key: "maxRedeliveries", label: "Max redeliveries", type: "number", min: 1, max: 20, step: 1, group: "Failures", showIf: { key: "dlx", equals: true } },
    { key: "costBaseHour", label: "Broker base price", type: "number", min: 0, max: 100, step: 0.05, unit: "$/h", group: "Cost" },
    { key: "costPerConsumerHour", label: "Price per consumer", type: "number", min: 0, max: 10, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "messageTtlSec", label: "Message TTL", type: "number", min: 0, max: 86400, step: 10, unit: "s", group: "Limits", help: "0 = never expire." },
    { key: "queueLimit", label: "Queue length limit", type: "number", min: 100, max: 1e7, step: 100, scale: "log", group: "Limits" },
    { key: "watermarkMsgs", label: "Memory watermark", type: "number", min: 1000, max: 1e7, step: 1000, unit: "msgs", scale: "log", group: "Limits", help: "Above this backlog the broker blocks publishers (flow control)." },
  ],
  asyncBoundary: true,
  costPerHour: (c) => c.costBaseHour + c.consumers * c.costPerConsumerHour,
  presets: [],
  faults: [],
  derived(c) {
    const per = perConsumerRate(c);
    return [
      { label: "Max unacked in flight", value: (c.consumers * c.prefetch).toLocaleString() },
      { label: "Effective rate / consumer", value: `${Math.round(per).toLocaleString()} msg/s`, tone: per < c.consumerRate ? "warn" : "ok", help: per < c.consumerRate ? "Prefetch too low: consumers wait on acks." : undefined },
      { label: "Group ceiling", value: `${Math.round(per * c.consumers).toLocaleString()} msg/s` },
    ];
  },
  metrics: [
    { id: "utilization", label: "Consumer utilization", unit: "%" },
    { id: "ready", label: "Ready messages", unit: "msg" },
    { id: "unacked", label: "Unacked messages", unit: "msg" },
    { id: "dlq", label: "Dead-lettered", unit: "msg" },
    { id: "blocked", label: "Publishers blocked", unit: "" },
    { id: "queueDepth", label: "Backlog", unit: "msg" },
  ],
  docs: {
    summary: "Messages are routed by an exchange into queues and consumed with a prefetch window.",
    models: ["Exchange routing multiplicity (fanout copies to all queues)", "Prefetch-limited consumer throughput", "Ready vs unacked messages", "Poison messages: requeued and re-failed without a DLX (they accumulate and crowd out good messages); dead-lettered with one", "Memory watermark blocks publishers", "TTL expiry and queue length limit"],
    simplifies: ["Queues are aggregated into one backlog", "Routing is by multiplicity, not real routing-key matching (the Routing lab does real matching)", "No mirroring / quorum queue replication cost", "Prefetch uses a fixed ack round-trip time", "Redelivery count is not tracked per message; the DLX dead-letters on first failure"],
    failureScenarios: ["Unbounded queue growth", "Publisher blocked by flow control", "Poison messages redelivering forever and crowding out good ones", "Auto-ack loses messages on consumer crash"],
    references: [{ title: "RabbitMQ: consumer prefetch", url: "https://www.rabbitmq.com/docs/consumer-prefetch" }, { title: "RabbitMQ: memory & flow control", url: "https://www.rabbitmq.com/docs/memory" }],
  },
  init: () => ({ good: 0, poison: 0, ready: 0, unacked: 0, dlq: 0, blocked: false, expired: 0, rate: 0, util: 0, wasBlocked: false }),
  validate(c) {
    const out = [];
    if (c.poisonRate > 0 && !c.dlx) out.push({ severity: "warn" as const, field: "dlx", message: "No DLX on this queue: poison messages will loop forever" });
    if (c.ackMode === "auto") out.push({ severity: "info" as const, field: "ackMode", message: "Auto-ack can lose messages if a consumer crashes" });
    if (c.prefetch === 1) out.push({ severity: "info" as const, field: "prefetch", message: "Prefetch 1 serializes consumers on ack round-trips" });
    return out;
  },
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const copies = c.exchange === "fanout" ? c.queues : c.exchange === "direct" ? 1 : Math.min(c.matchedQueues, c.queues);
    let dropped = 0;
    let arrivals = m.count * copies;
    // flow control: publishers blocked above the watermark; the queue length limit rejects
    const backlog = s.good + s.poison;
    const blocked = backlog > c.watermarkMsgs;
    if (blocked) { dropped += arrivals / copies; arrivals = 0; }
    const room = Math.max(0, c.queueLimit * c.queues - backlog);
    if (arrivals > room) { dropped += (arrivals - room) / copies; arrivals = room; }
    if (blocked && !s.wasBlocked) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "flow-control", message: "Memory watermark hit — publishers blocked" });

    const per = perConsumerRate(c);
    const full = per * c.consumers * ctx.dt;
    // Poison messages always fail. Without a DLX they are requeued and fail again, forever.
    let good = s.good + arrivals * (1 - c.poisonRate), poison = s.poison + arrivals * c.poisonRate;
    const total = good + poison;
    const take = Math.min(total, full);
    const takePoison = total > 0 ? take * (poison / total) : 0;
    const takeGood = take - takePoison;
    good -= takeGood;
    let dlq = s.dlq;
    if (c.dlx) { poison -= takePoison; dlq += takePoison; }
    let expired = s.expired, expiredNow = 0;
    if (c.messageTtlSec > 0 && full > 0) {
      const lim = (full / ctx.dt) * c.messageTtlSec;
      if (good > lim) { expiredNow = good - lim; good = lim; expired += expiredNow; }
    }
    // messages the downstream rejected: manual ack re-queues them, auto-ack has already lost them
    let failedDown = 0;
    for (const id of ctx.outEdges.consume ?? []) failedDown += ctx.feedback(id).failed;
    const requeued = c.ackMode === "manual" ? failedDown : 0;
    good += requeued;
    const ready = good + poison;
    const lat = m.latencyMs + 1 + (full > 0 ? (ready / (full / ctx.dt)) * 1000 : 0);
    return {
      state: { good, poison, ready, unacked: Math.min(c.consumers * c.prefetch, take > 0 ? ready : 0), dlq, blocked, expired, rate: takeGood / ctx.dt, util: full > 0 ? take / full : 0, wasBlocked: blocked },
      outbound: [
        { port: "consume", count: takeGood, latencyMs: lat, readFraction: m.readFraction },
        ...(c.dlx && takePoison > 0 ? [{ port: "dlx", count: takePoison, latencyMs: lat, readFraction: 0 }] : []),
      ],
      dropped: dropped + expiredNow / copies, events, recovered: requeued,
    };
  },
  sample: (_c, s) => ({ utilization: Math.min(1, s.util), ready: s.ready, unacked: s.unacked, dlq: s.dlq, blocked: s.blocked ? 1 : 0, queueDepth: s.ready }),
});
