import { defineComponent } from "../../core/define";
import { mergeInflows, stepQueue } from "../../core/flow";
import type { DerivedValue, SimEvent } from "../../core/types";
import { ec2Presets } from "./presets";

interface Config {
  count: number; vcpu: number; memoryGiB: number; burstable: boolean; creditsPerHour: number; initialCredits: number;
  networkMbps: number; cpuCostMs: number; payloadKB: number; memoryPerConnMB: number; queueLimit: number; costPerHourEach: number;
  [k: string]: number | boolean;
}
interface State { credits: number; depth: number; util: number; cpuUtil: number; netUtil: number; memUtil: number; throttled: boolean; out: number; capacity: number }

export default defineComponent<Config, State>({
  kind: "ec2",
  sink: true,
  version: "1.0.0",
  name: "EC2 instances",
  description: "A fleet of identical VMs with CPU, memory, network limits and T-family burst credits.",
  category: "compute",
  icon: "server",
  ports: [
    { id: "in", direction: "in", label: "Requests", protocols: ["http", "grpc", "tcp", "websocket"] },
    { id: "out", direction: "out", label: "Downstream", protocols: ["cache-access", "database", "message-queue", "event-stream", "http", "grpc"] },
  ],
  defaults: { count: 2, vcpu: 1, memoryGiB: 1, burstable: true, creditsPerHour: 6, initialCredits: 30, networkMbps: 60, cpuCostMs: 20, payloadKB: 8, memoryPerConnMB: 2, queueLimit: 500, costPerHourEach: 0.0116 },
  fields: [
    { key: "count", label: "Instance count", type: "number", min: 1, max: 200, step: 1, group: "Fleet" },
    { key: "vcpu", label: "vCPU per instance", type: "number", min: 1, max: 64, step: 1, group: "Instance" },
    { key: "memoryGiB", label: "Memory per instance", type: "number", min: 0.5, max: 256, step: 0.5, unit: "GiB", scale: "log", group: "Instance" },
    { key: "networkMbps", label: "Network limit", type: "number", min: 10, max: 25000, step: 10, unit: "Mbps", scale: "log", group: "Instance", help: "Approximate sustained bandwidth per instance." },
    { key: "burstable", label: "Burstable (T-family)", type: "switch", group: "CPU credits", help: "T-family instances run above baseline only while they hold credits." },
    { key: "creditsPerHour", label: "Credits earned", type: "number", min: 0, max: 400, step: 1, unit: "/h", group: "CPU credits", showIf: { key: "burstable", equals: true }, help: "1 credit = one vCPU at 100% for one minute." },
    { key: "initialCredits", label: "Launch credits", type: "number", min: 0, max: 1000, step: 5, group: "CPU credits", showIf: { key: "burstable", equals: true } },
    { key: "cpuCostMs", label: "CPU per request", type: "number", min: 0.1, max: 2000, step: 0.1, unit: "ms", scale: "log", group: "Workload", help: "vCPU-milliseconds one request consumes. Measure it from your own service." },
    { key: "payloadKB", label: "Response size", type: "number", min: 0.1, max: 4096, step: 0.1, unit: "KB", scale: "log", group: "Workload" },
    { key: "memoryPerConnMB", label: "Memory per in-flight request", type: "number", min: 0.1, max: 64, step: 0.1, unit: "MB", group: "Workload" },
    { key: "queueLimit", label: "Request queue limit", type: "number", min: 0, max: 100000, step: 50, group: "Workload", help: "Per fleet. Beyond this, requests are rejected." },
    { key: "costPerHourEach", label: "Price per instance", type: "number", min: 0, max: 50, step: 0.001, unit: "$/h", group: "Cost" },
  ],
  presets: ec2Presets,
  derived(c) {
    const cpuRps = (c.count * c.vcpu * 1000) / c.cpuCostMs;
    const baseline = c.burstable ? (c.creditsPerHour / 60 / c.vcpu) : 1;
    const baseRps = cpuRps * Math.min(1, baseline);
    const netRps = (c.networkMbps * 1e6 / 8 * c.count) / (c.payloadKB * 1024);
    const out: DerivedValue[] = [
      { label: "CPU-bound ceiling", value: `${Math.round(cpuRps).toLocaleString()} req/s`, help: "With full CPU available." },
      { label: "Network-bound ceiling", value: `${Math.round(netRps).toLocaleString()} req/s`, tone: netRps < cpuRps ? "warn" : "ok" },
    ];
    if (c.burstable) {
      out.push({ label: "Baseline CPU (no credits)", value: `${(baseline * 100).toFixed(0)}% per vCPU → ${Math.round(baseRps).toLocaleString()} req/s`, tone: "warn" });
      const net = c.vcpu - c.creditsPerHour / 60;
      out.push({ label: "Credits last at full burn", value: net > 0 ? `${(c.initialCredits / net).toFixed(0)} min` : "∞", help: "Time from launch credits to throttling under 100% CPU.", tone: "warn" });
    }
    return out;
  },
  metrics: [
    { id: "utilization", label: "Utilization", unit: "%", description: "Served / capacity" },
    { id: "cpu", label: "CPU", unit: "%" },
    { id: "memory", label: "Memory", unit: "%" },
    { id: "network", label: "Network", unit: "%" },
    { id: "credits", label: "CPU credits / instance", unit: "credits" },
    { id: "queueDepth", label: "Queue depth", unit: "req" },
  ],
  docs: {
    summary: "Fleet of VMs. Capacity comes from vCPU × time ÷ CPU cost per request, then is clamped by network and memory.",
    models: ["CPU-bound throughput", "T-family credit balance: earn per hour, spend per vCPU-minute, fall to baseline at zero", "Network bandwidth ceiling from response size", "Memory pressure from in-flight requests", "Bounded request queue with reject-on-full"],
    simplifies: ["All instances identical and evenly loaded", "Credit model is the T2 standard mode; T3 unlimited mode is not modeled", "Network is a flat sustained limit, no burst bucket", "Memory overload halves capacity instead of OOM-killing"],
    failureScenarios: ["Fine for ~20 minutes then CPU credits run out and throughput collapses to baseline", "Network-bound before CPU-bound for large responses", "Queue overflow rejects requests"],
    references: [{ title: "AWS: CPU credits and baseline utilization for burstable instances", url: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html" }],
  },
  init: (c) => ({ credits: c.burstable ? c.initialCredits : 0, depth: 0, util: 0, cpuUtil: 0, netUtil: 0, memUtil: 0, throttled: false, out: 0, capacity: 0 }),
  costPerHour: (c) => c.count * c.costPerHourEach,
  validate: (c, v) => v.incoming.length === 0 ? [{ severity: "info", message: "Nothing sends traffic here yet" }] : [],
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const svcSec = c.cpuCostMs / 1000;
    // CPU: vCPU-seconds available this tick, limited by credits when burstable.
    const earned = c.burstable ? (c.count * c.creditsPerHour * ctx.dt) / 3600 : 0;
    const fullCpu = c.count * c.vcpu * ctx.dt;
    const cpuBudget = c.burstable ? Math.min(fullCpu, (s.credits * c.count + earned) * 60) : fullCpu;
    let capacity = cpuBudget / svcSec;
    const netCap = ((c.networkMbps * 1e6) / 8 * c.count * ctx.dt) / (c.payloadKB * 1024);
    capacity = Math.min(capacity, netCap);
    // Memory pressure: in-flight requests ≈ throughput × service time.
    const inFlightPerInstance = (s.out / ctx.dt) * svcSec / c.count;
    const memUtil = (400 + inFlightPerInstance * c.memoryPerConnMB) / (c.memoryGiB * 1024);
    if (memUtil > 0.95) capacity *= 0.5;
    const q = stepQueue(s.depth, m.count, capacity, c.queueLimit, ctx.dt);
    const spent = (q.processed * svcSec) / 60;
    let credits = s.credits;
    if (c.burstable) {
      credits = Math.max(0, Math.min(Math.max(c.creditsPerHour * 24, c.initialCredits), credits + (earned - spent) / c.count));
      if (s.credits > 0 && credits === 0) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "credits-exhausted", message: "CPU credits exhausted — throttled to baseline" });
    }
    const throttled = c.burstable && credits === 0;
    const service = ctx.rng.lognormal(c.cpuCostMs, 0.3);
    const lat = m.latencyMs + service + q.waitMs;
    return {
      state: {
        credits, depth: q.depth, out: q.processed,
        util: capacity > 0 ? q.processed / capacity : 0,
        cpuUtil: fullCpu > 0 ? (q.processed * svcSec) / fullCpu : 0,
        netUtil: netCap > 0 ? q.processed / netCap : 0,
        memUtil, throttled, capacity: capacity / ctx.dt,
      },
      outbound: [{ port: "out", count: q.processed, latencyMs: lat, readFraction: m.readFraction }],
      dropped: q.dropped,
      events,
    };
  },
  sample: (_c, s) => ({ utilization: s.util, cpu: s.cpuUtil, memory: s.memUtil, network: s.netUtil, credits: s.credits, queueDepth: s.depth, capacityRps: s.capacity, throttled: s.throttled ? 1 : 0 }),
});
