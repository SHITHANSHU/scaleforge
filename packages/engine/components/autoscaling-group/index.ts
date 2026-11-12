import { defineComponent } from "../../core/define";
import type { SimEvent } from "../../core/types";
import ec2 from "../ec2";
import { ec2Presets } from "../ec2/presets";

type Ec2Config = typeof ec2.defaults;
interface Config extends Ec2Config { minSize: number; maxSize: number; targetCpu: number; cooldownSec: number; warmupSec: number; scaleStep: number; [k: string]: number | boolean }
type Ec2State = ReturnType<typeof ec2.init>;
interface State { inner: Ec2State; ready: number; pending: { at: number; n: number }[]; lastScale: number; avgUtil: number }

/** Composition example: an autoscaler wrapping the EC2 model without modifying it. */
export default defineComponent<Config, State>({
  ...ec2,
  kind: "autoscaling-group",
  version: "1.0.0",
  name: "Auto Scaling group",
  description: "EC2 fleet that scales out and in on CPU, with cooldown and instance warm-up delay.",
  icon: "layers",
  defaults: { ...ec2.defaults, count: 2, minSize: 2, maxSize: 20, targetCpu: 0.6, cooldownSec: 60, warmupSec: 90, scaleStep: 2 },
  fields: [
    { ...ec2.fields.find((f) => f.key === "count")!, label: "Initial size", help: "Informational: the group starts at its minimum size and then follows load." },
    ...ec2.fields.filter((f) => f.key !== "count"),
    { key: "minSize", label: "Minimum size", type: "number", min: 1, max: 200, step: 1, group: "Scaling" },
    { key: "maxSize", label: "Maximum size", type: "number", min: 1, max: 500, step: 1, group: "Scaling" },
    { key: "targetCpu", label: "Target CPU", type: "number", min: 0.1, max: 0.95, step: 0.05, group: "Scaling", help: "Scale out above this, scale in well below it." },
    { key: "scaleStep", label: "Instances per step", type: "number", min: 1, max: 50, step: 1, group: "Scaling" },
    { key: "cooldownSec", label: "Cooldown", type: "number", min: 0, max: 900, step: 5, unit: "s", group: "Scaling", help: "Minimum time between scaling actions." },
    { key: "warmupSec", label: "Warm-up", type: "number", min: 0, max: 900, step: 5, unit: "s", group: "Scaling", help: "New instances take this long to boot and start serving." },
  ],
  presets: ec2Presets,
  derived(c) {
    const ec = ec2.derived!({ ...c, count: c.minSize });
    return [...ec, { label: "Reaction time to a spike", value: `~${c.cooldownSec + c.warmupSec} s`, tone: c.cooldownSec + c.warmupSec > 120 ? "warn" : "ok", help: "Cooldown plus warm-up before new capacity serves traffic." }];
  },
  metrics: [...ec2.metrics, { id: "instances", label: "Instances in service", unit: "" }, { id: "pending", label: "Instances warming up", unit: "" }],
  docs: {
    ...ec2.docs,
    summary: "An EC2 fleet whose size follows load. Reuses the EC2 model for per-instance behavior.",
    models: [...ec2.docs.models, "Scale-out/in by target CPU with cooldown", "Warm-up delay before new instances take traffic"],
    simplifies: [...ec2.docs.simplifies, "Simple target-tracking, no predictive or scheduled scaling", "New instances start with full launch credits"],
    failureScenarios: [...ec2.docs.failureScenarios, "Scaling too late: queue overflows during warm-up", "Flapping with a short cooldown"],
  },
  init: (c) => ({ inner: ec2.init(c), ready: c.minSize, pending: [], lastScale: -1e9, avgUtil: 0 }),
  validate: (c, v) => [...(ec2.validate?.(c, v) ?? []), ...(c.minSize > c.maxSize ? [{ severity: "error" as const, field: "minSize", message: "Minimum exceeds maximum" }] : [])],
  costPerHour: (c, s) => ((s ? s.ready + s.pending.reduce((a, p) => a + p.n, 0) : c.minSize) * c.costPerHourEach),
  tick(ctx, c, s, inbound) {
    const events: SimEvent[] = [];
    let ready = s.ready;
    const pending: State["pending"] = [];
    for (const p of s.pending) if (ctx.time >= p.at) { ready += p.n; } else pending.push(p);
    ready = Math.min(Math.max(ready, c.minSize), c.maxSize);
    const inFlight = pending.reduce((a, p) => a + p.n, 0);
    // scale on real pressure: CPU, or served/capacity (a throttled burstable fleet reads low CPU but is saturated)
    const util = Math.max(s.inner.cpuUtil, s.inner.util);
    const alpha = 1 - Math.exp(-ctx.dt / 10);
    const avg = s.avgUtil + (util - s.avgUtil) * alpha;
    let lastScale = s.lastScale;
    if (ctx.time - lastScale >= c.cooldownSec) {
      if (avg > c.targetCpu && ready + inFlight < c.maxSize) {
        const n = Math.min(c.scaleStep, c.maxSize - ready - inFlight);
        pending.push({ at: ctx.time + c.warmupSec, n }); lastScale = ctx.time;
        events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "info", kind: "scale-out", message: `Scaling out +${n} (CPU ${(avg * 100).toFixed(0)}%), ready in ${c.warmupSec}s` });
      } else if (avg < c.targetCpu * 0.5 && ready > c.minSize) {
        const n = Math.min(c.scaleStep, ready - c.minSize);
        ready -= n; lastScale = ctx.time;
        events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "info", kind: "scale-in", message: `Scaling in −${n} (CPU ${(avg * 100).toFixed(0)}%)` });
      }
    }
    const r = ec2.tick(ctx, { ...c, count: ready }, s.inner, inbound);
    return { ...r, state: { inner: r.state, ready, pending, lastScale, avgUtil: avg }, events: [...events, ...r.events] };
  },
  sample: (c, s) => ({ ...ec2.sample({ ...c, count: s.ready }, s.inner), instances: s.ready, pending: s.pending.reduce((a, p) => a + p.n, 0) }),
});
