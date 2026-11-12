import { defineComponent } from "../../core/define";
import { clamp, mergeInflows, stepQueue } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config {
  pods: number; maxPods: number; vcpuPerPod: number; cpuMsPerReq: number; startupSec: number; queueLimit: number; costPerPodHour: number;
  hpa: boolean; hpaMetric: string; hpaTarget: number; hpaCooldownSec: number; maxStepPods: number; scaleDownDelaySec: number;
  strategy: string; maxSurgePct: number; canaryPct: number; canaryHoldSec: number; autoRollback: boolean; rollbackErrorPct: number; detectSec: number; gracefulSec: number;
  cacheFallback: boolean;
  [k: string]: number | string | boolean;
}
type Phase = "idle" | "rolling" | "canary" | "bluegreen" | "rollingback";
interface State {
  old: number; neu: number; startingOld: { at: number; n: number }[]; startingNew: { at: number; n: number }[]; depth: number;
  phase: Phase; phaseSince: number; flipped: boolean; bad: { err: number; lat: number } | null; hadRelease: boolean;
  badTimer: number; lastScale: number; belowSince: number; desired: number; util: number; errPct: number; newShare: number; rollbacks: number; fallbackRate: number; queueWaitMs: number;
  tracksNewAsPrimary: boolean;
}

export default defineComponent<Config, State>({
  kind: "app-service",
  sink: true,
  version: "1.0.0",
  name: "App service (containers)",
  description: "A containerised service with autoscaling, rolling / canary / blue-green releases, a bad-release fault, rollback, and cache fallback.",
  category: "compute",
  icon: "container",
  ports: [
    { id: "in", direction: "in", label: "Requests", protocols: ["http", "grpc", "websocket"] },
    { id: "cache", direction: "out", label: "Cache", protocols: ["cache-access"] },
    { id: "db", direction: "out", label: "Database", protocols: ["database"] },
    { id: "out", direction: "out", label: "Downstream", protocols: ["http", "grpc", "message-queue", "event-stream", "database", "cache-access"] },
  ],
  defaults: {
    pods: 4, maxPods: 40, vcpuPerPod: 2, cpuMsPerReq: 20, startupSec: 40, queueLimit: 400, costPerPodHour: 0.09,
    hpa: true, hpaMetric: "cpu", hpaTarget: 0.6, hpaCooldownSec: 30, maxStepPods: 4, scaleDownDelaySec: 120,
    strategy: "rolling", maxSurgePct: 25, canaryPct: 10, canaryHoldSec: 60, autoRollback: false, rollbackErrorPct: 5, detectSec: 30, gracefulSec: 15,
    cacheFallback: false,
  },
  fields: [
    { key: "pods", label: "Replicas (minimum)", type: "number", min: 1, max: 200, step: 1, group: "Fleet" },
    { key: "vcpuPerPod", label: "CPU limit per pod", type: "number", min: 0.25, max: 32, step: 0.25, unit: "vCPU", group: "Fleet" },
    { key: "cpuMsPerReq", label: "CPU per request", type: "number", min: 0.1, max: 2000, step: 0.1, unit: "ms", scale: "log", group: "Fleet", help: "CPU-milliseconds one request needs. Capacity = pods × vCPU ÷ this." },
    { key: "startupSec", label: "Start-up + readiness time", type: "number", min: 1, max: 600, step: 1, unit: "s", group: "Fleet", help: "A new pod takes this long before it receives traffic." },
    { key: "queueLimit", label: "Request queue per fleet", type: "number", min: 0, max: 1e6, step: 10, group: "Fleet" },
    { key: "costPerPodHour", label: "Price per pod", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "hpa", label: "Autoscale", type: "switch", group: "Autoscaling" },
    { key: "maxPods", label: "Maximum replicas", type: "number", min: 1, max: 500, step: 1, group: "Autoscaling", showIf: { key: "hpa", equals: true } },
    { key: "hpaMetric", label: "Scale on", type: "select", group: "Autoscaling", showIf: { key: "hpa", equals: true }, options: [{ value: "cpu", label: "CPU utilization", hint: "Reacts after pods are already busy" }, { value: "queue", label: "Queue wait", hint: "Reacts to backlog; sees load even when CPU is capped" }] },
    { key: "hpaTarget", label: "Target", type: "number", min: 0.05, max: 10, step: 0.05, group: "Autoscaling", showIf: { key: "hpa", equals: true }, help: "CPU: fraction (0.6 = 60%). Queue: seconds of backlog." },
    { key: "hpaCooldownSec", label: "Scale-up cooldown", type: "number", min: 1, max: 600, step: 1, unit: "s", group: "Autoscaling", showIf: { key: "hpa", equals: true } },
    { key: "maxStepPods", label: "Max pods added per step", type: "number", min: 1, max: 100, step: 1, group: "Autoscaling", showIf: { key: "hpa", equals: true } },
    { key: "scaleDownDelaySec", label: "Scale-down stabilization", type: "number", min: 10, max: 3600, step: 10, unit: "s", group: "Autoscaling", showIf: { key: "hpa", equals: true } },
    { key: "strategy", label: "Release strategy", type: "select", group: "Releases", options: [
      { value: "rolling", label: "Rolling", hint: "Replace pods in batches (surge)" },
      { value: "canary", label: "Canary", hint: "Small share first, then roll the rest" },
      { value: "bluegreen", label: "Blue-green", hint: "Full second fleet, then flip all traffic" },
    ] },
    { key: "maxSurgePct", label: "Max surge", type: "number", min: 5, max: 100, step: 5, unit: "%", group: "Releases", help: "Extra pods started per rolling step, as a share of the fleet." },
    { key: "canaryPct", label: "Canary share", type: "number", min: 1, max: 50, step: 1, unit: "%", group: "Releases", showIf: { key: "strategy", equals: "canary" } },
    { key: "canaryHoldSec", label: "Hold before continuing", type: "number", min: 5, max: 1800, step: 5, unit: "s", group: "Releases", help: "Canary: watch time. Blue-green: how long the old fleet is kept for rollback." },
    { key: "autoRollback", label: "Automatic rollback", type: "switch", group: "Releases", help: "Roll back when the new version's error rate stays above the threshold." },
    { key: "rollbackErrorPct", label: "Rollback error threshold", type: "number", min: 0.5, max: 100, step: 0.5, unit: "%", group: "Releases", showIf: { key: "autoRollback", equals: true } },
    { key: "detectSec", label: "Time to confirm a problem", type: "number", min: 1, max: 600, step: 1, unit: "s", group: "Releases", showIf: { key: "autoRollback", equals: true } },
    { key: "gracefulSec", label: "Graceful shutdown", type: "number", min: 0, max: 300, step: 1, unit: "s", group: "Releases", help: "Time pods get to finish in-flight work when removed. Too short drops requests." },
    { key: "cacheFallback", label: "Fall back to the database if the cache fails", type: "switch", group: "Resilience", help: "Fail-open to the database. Keeps requests working — and sends the whole read load there." },
  ],
  presets: [],
  faults: [
    { kind: "release", label: "Roll out a new version", description: "Start a release. (Params: errPct = error % of the new version, latencyX = latency multiplier.) Health checks still pass." },
    { kind: "rollback", label: "Operator rollback", description: "Manually roll back to the previous version." },
  ],
  costPerHour: (c, s) => (s ? s.old + s.neu + s.startingOld.reduce((a, p) => a + p.n, 0) + s.startingNew.reduce((a, p) => a + p.n, 0) : c.pods) * c.costPerPodHour,
  derived(c) {
    const per = (c.vcpuPerPod * 1000) / c.cpuMsPerReq;
    return [
      { label: "Capacity per pod", value: `${Math.round(per).toLocaleString()} req/s` },
      { label: "Fleet capacity (minimum)", value: `${Math.round(per * c.pods).toLocaleString()} req/s` },
      { label: "Scale-up reaction time", value: `~${c.hpaCooldownSec + c.startupSec} s`, tone: c.hpa && c.hpaCooldownSec + c.startupSec > 90 ? "warn" : "ok", help: "Cooldown plus pod start-up before new capacity serves traffic." },
      { label: "Full-rollout duration", value: c.strategy === "bluegreen" ? `~${c.startupSec} s` : `~${Math.ceil(100 / c.maxSurgePct) * c.startupSec} s`, help: "Each rolling step waits for new pods to become ready." },
    ];
  },
  metrics: [
    { id: "utilization", label: "CPU utilization", unit: "%" },
    { id: "pods", label: "Pods serving", unit: "" },
    { id: "podsStarting", label: "Pods starting", unit: "" },
    { id: "newVersionShare", label: "Traffic on new version", unit: "%" },
    { id: "versionErrorPct", label: "5xx from new version", unit: "%" },
    { id: "rolloutState", label: "Release (0 idle, 1 rolling, 2 canary, 3 blue-green, 4 rolling back)", unit: "" },
    { id: "queueWaitMs", label: "Queue wait", unit: "ms" },
    { id: "fallbackRate", label: "Cache-fallback reads", unit: "req/s" },
    { id: "queueDepth", label: "Queue depth", unit: "req" },
  ],
  docs: {
    summary: "A deployment of identical pods. Traffic is served by ready pods only; scaling and releases both take time.",
    models: [
      "Capacity = ready pods × CPU ÷ cost per request, with a bounded queue",
      "Pod start-up and readiness delay: new capacity arrives late",
      "Autoscaling on CPU or queue wait, with cooldown, step limit and scale-down stabilization",
      "Rolling updates in surge batches, canary (small share, hold, then continue) and blue-green (full second fleet, flip, keep old for rollback)",
      "A bad release: a configurable error rate and latency multiplier that readiness checks do not catch",
      "Automatic rollback after confirming sustained errors, or an operator rollback fault; rolling back mid-rollout leaves a capacity dip while old pods restart",
      "Graceful shutdown: pods removed with too short a drain period drop in-flight work",
      "Cache fail-open to the database",
    ],
    simplifies: [
      "Pods are identical and share load perfectly; no per-pod queues or connection pools",
      "CPU only: no memory limits, OOM kills, throttling or noisy neighbours",
      "The percentage defaults (25% surge) mirror Kubernetes defaults; canary and blue-green behaviour are modelling choices, since the sources consulted define only rolling updates",
      "HPA uses a simple proportional rule without the real controller's tolerance and stabilization windows",
      "Error detection is the new version's true error rate, observed for the confirmation time; real detection depends on monitoring quality",
    ],
    failureScenarios: ["Spike arrives faster than pods can start", "Bad release reaches 100% because checks pass", "Rollback during a rolling update drops capacity", "Short graceful period drops in-flight requests during deploys", "Cache outage dumps all reads on the database"],
    references: [
      { title: "Kubernetes: Deployments (rolling update)", url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/" },
      { title: "Kubernetes: Horizontal Pod Autoscaling", url: "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/" },
      { title: "Kubernetes: liveness, readiness and startup probes", url: "https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/" },
      { title: "AWS Builders' Library: Using load shedding to avoid overload", url: "https://builder.aws.com/content/3Eun1EEyX6p2e3VYNyRLSJzLuMV/using-load-shedding-to-avoid-overload" },
    ],
  },
  init: (c) => ({
    old: c.pods, neu: 0, startingOld: [], startingNew: [], depth: 0, phase: "idle", phaseSince: 0, flipped: false, bad: null, hadRelease: false, badTimer: 0, lastScale: -1e9, belowSince: -1,
    desired: c.pods, util: 0, errPct: 0, newShare: 0, rollbacks: 0, fallbackRate: 0, queueWaitMs: 0, tracksNewAsPrimary: false,
  }),
  validate: (c, v) => [
    ...(v.incoming.length === 0 ? [{ severity: "info" as const, message: "Nothing sends traffic here yet" }] : []),
    ...(c.hpa && c.maxPods < c.pods ? [{ severity: "error" as const, field: "maxPods", message: "Maximum replicas below the minimum" }] : []),
    ...(c.gracefulSec < 5 ? [{ severity: "info" as const, field: "gracefulSec", message: "Very short graceful shutdown: in-flight requests may be dropped on deploys" }] : []),
    ...(!c.autoRollback ? [{ severity: "info" as const, field: "autoRollback", message: "No automatic rollback: a bad release persists until someone intervenes" }] : []),
  ],
  tick(ctx, c, s0, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const t = ctx.time, dt = ctx.dt;
    const s: State = { ...s0, startingOld: [...s0.startingOld], startingNew: [...s0.startingNew] };
    const say = (severity: SimEvent["severity"], kind: string, message: string) => events.push({ time: t, nodeId: ctx.nodeId, severity, kind, message });

    // pods finishing start-up
    const doneOld = s.startingOld.filter((p) => p.at <= t).reduce((a, p) => a + p.n, 0), doneNew = s.startingNew.filter((p) => p.at <= t).reduce((a, p) => a + p.n, 0);
    s.startingOld = s.startingOld.filter((p) => p.at > t); s.startingNew = s.startingNew.filter((p) => p.at > t);
    s.old += doneOld; s.neu += doneNew;
    const fleetTarget = Math.max(c.pods, s.desired);
    const startingNewN = () => s.startingNew.reduce((a, p) => a + p.n, 0), startingOldN = () => s.startingOld.reduce((a, p) => a + p.n, 0);

    let dropped = 0;
    const drain = (n: number) => { // graceful shutdown: pods removed with too little drain time lose their in-flight share
      const perPod = (s0.depth / Math.max(1, s.old + s.neu)) * Math.max(0, 1 - c.gracefulSec / Math.max(1, s0.queueWaitMs / 1000 + 1));
      dropped += perPod * n; s.depth = Math.max(0, s.depth - perPod * n);
    };
    const startRollback = (why: string) => {
      say("warn", "rollback", `Rolling back: ${why}`);
      s.rollbacks++;
      if (s.phase === "bluegreen" && s.old > 0) { drain(s.neu); s.neu = 0; s.startingNew = []; s.flipped = false; s.phase = "idle"; s.tracksNewAsPrimary = false; }
      else { drain(s.neu); s.neu = 0; s.startingNew = []; s.tracksNewAsPrimary = false; const missing = Math.max(0, fleetTarget - s.old - startingOldN()); if (missing > 0) s.startingOld.push({ at: t + c.startupSec, n: missing }); s.phase = "rollingback"; s.phaseSince = t; }
      s.bad = null; s.badTimer = 0;
    };

    // ---- release lifecycle ----
    for (const f of ctx.faults) {
      if (f.kind === "release" && f.justStarted && s.phase === "idle") {
        s.hadRelease = true; s.phaseSince = t; s.badTimer = 0;
        s.bad = { err: Number(f.params.errPct ?? 0) / 100, lat: Number(f.params.latencyX ?? 1) };
        if (c.strategy === "bluegreen") { s.phase = "bluegreen"; s.startingNew.push({ at: t + c.startupSec, n: fleetTarget }); say("info", "release", "Blue-green release: starting a full second fleet"); }
        else if (c.strategy === "canary") { s.phase = "canary"; const n = Math.max(1, Math.ceil((fleetTarget * c.canaryPct) / 100)); s.startingNew.push({ at: t + c.startupSec, n }); say("info", "release", `Canary release: ${n} new pod(s)`); }
        else { s.phase = "rolling"; const n = Math.max(1, Math.ceil((fleetTarget * c.maxSurgePct) / 100)); s.startingNew.push({ at: t + c.startupSec, n }); say("info", "release", "Rolling release started"); }
      }
      if (f.kind === "rollback" && f.justStarted && s.phase !== "rollingback" && (s.phase !== "idle" || s.bad)) startRollback("operator action");
    }
    const newShare = (() => {
      const ready = s.old + s.neu; if (ready <= 0 || s.neu <= 0) return 0;
      if (s.phase === "bluegreen" && s.old > 0) return s.flipped ? 1 : 0;
      return s.neu / ready;
    })();
    // detection of a bad version
    if (s.bad && newShare > 0 && s.bad.err * 100 >= c.rollbackErrorPct) s.badTimer += dt; else s.badTimer = 0;
    if (c.autoRollback && s.badTimer >= c.detectSec && s.phase !== "rollingback") startRollback(`new version errors at ${(s.bad!.err * 100).toFixed(0)}% for ${c.detectSec}s`);

    if (s.phase === "bluegreen" && !s.flipped && s.neu >= fleetTarget) { s.flipped = true; s.phaseSince = t; say("info", "flip", "Traffic flipped to the new fleet"); }
    if (s.phase === "bluegreen" && s.flipped && t - s.phaseSince >= c.canaryHoldSec) { s.old = 0; s.phase = "idle"; say("info", "release-done", "Blue-green complete — old fleet removed"); s.tracksNewAsPrimary = true; /* a bad version stays live until rolled back */ }
    if (s.phase === "canary" && s.neu > 0 && startingNewN() === 0 && t - s.phaseSince >= c.startupSec + c.canaryHoldSec) { s.phase = "rolling"; s.phaseSince = t; const n = Math.max(1, Math.ceil((fleetTarget * c.maxSurgePct) / 100)); s.startingNew.push({ at: t + c.startupSec, n: Math.min(n, Math.max(0, fleetTarget - s.neu)) }); say("info", "release", "Canary healthy — rolling the rest"); }
    if (s.phase === "rolling" || s.phase === "canary") {
      const surge = Math.max(1, Math.ceil((fleetTarget * c.maxSurgePct) / 100));
      // keep old + new within the target: every new pod that becomes ready replaces an old one
      if (s.old > 0) { const rm = Math.min(s.old, Math.max(0, s.old + s.neu - fleetTarget)); if (rm > 0) { drain(rm); s.old -= rm; } }
      if (s.phase === "rolling") {
        if (s.old <= 0 && startingNewN() === 0 && s.neu >= fleetTarget) { s.phase = "idle"; s.phaseSince = t; s.tracksNewAsPrimary = true; say("info", "release-done", "Rolling release complete"); }
        else if (startingNewN() === 0 && s.neu < fleetTarget) s.startingNew.push({ at: t + c.startupSec, n: Math.min(surge, fleetTarget - s.neu) });
      }
    }
    if (s.phase === "rollingback" && startingOldN() === 0 && s.old >= fleetTarget) { s.phase = "idle"; s.phaseSince = t; s.tracksNewAsPrimary = false; say("info", "rollback-done", "Rollback complete — previous version fully restored"); }

    // ---- autoscaling (on the primary fleet) ----
    const readyN = s.old + s.neu;
    if (c.hpa && s.phase === "idle") {
      const metric = c.hpaMetric === "queue" ? s0.queueWaitMs / 1000 : s0.util;
      const want = clamp(Math.ceil(readyN * (metric / c.hpaTarget)), c.pods, c.maxPods);
      const pendingN = startingOldN() + startingNewN();
      if (want > readyN + pendingN && t - s.lastScale >= c.hpaCooldownSec) {
        const n = Math.min(c.maxStepPods, want - readyN - pendingN);
        (s.tracksNewAsPrimary ? s.startingNew : s.startingOld).push({ at: t + c.startupSec, n });
        s.lastScale = t; s.desired = want; s.belowSince = -1;
        say("info", "scale-out", `Scaling out +${n} (${c.hpaMetric === "queue" ? `queue wait ${(metric * 1000).toFixed(0)} ms` : `CPU ${(metric * 100).toFixed(0)}%`}), ready in ${c.startupSec}s`);
      } else if (want < readyN && readyN > c.pods) {
        if (s.belowSince < 0) s.belowSince = t;
        if (t - s.belowSince >= c.scaleDownDelaySec) { const n = Math.min(readyN - c.pods, Math.max(1, readyN - want)); if (s.tracksNewAsPrimary) { drain(Math.min(n, s.neu)); s.neu = Math.max(0, s.neu - n); } else { drain(Math.min(n, s.old)); s.old = Math.max(0, s.old - n); } s.desired = Math.max(c.pods, readyN - n); s.belowSince = -1; say("info", "scale-in", `Scaling in −${n}`); }
      } else s.belowSince = -1;
    }

    // ---- serving ----
    const pods = s.old + s.neu;
    const share = newShare;
    const perPodRps = (c.vcpuPerPod * 1000) / c.cpuMsPerReq;
    const capacity = pods * perPodRps * dt;
    const q = stepQueue(s.depth, m.count, capacity, c.queueLimit, dt);
    dropped += q.dropped;
    const badErr = s.bad ? s.bad.err * share : 0;
    const errored = q.processed * badErr;
    const ok = q.processed - errored;
    dropped += errored;
    const latMul = 1 + (s.bad ? (s.bad.lat - 1) * share : 0);
    const lat = m.latencyMs + (c.cpuMsPerReq * latMul) + q.waitMs;

    // ---- routing: cache / db / generic downstream ----
    const has = (port: string) => (ctx.outEdges[port]?.length ?? 0) > 0;
    const reads = ok * m.readFraction, writes = ok - reads;
    let cacheFail = 0, fallback = 0;
    if (has("cache")) for (const id of ctx.outEdges.cache!) { const f = ctx.feedback(id); cacheFail += f.failed; }
    const cacheDown = has("cache") && ctx.outEdges.cache!.every((id) => ctx.isEdgeTargetDown(id));
    const out: { port: string; count: number; latencyMs: number; readFraction: number }[] = [];
    let recovered = 0;
    const emit = (port: string, count: number, rf: number) => { if (count > 0) out.push({ port, count, latencyMs: lat, readFraction: rf }); };
    if (has("db") || has("cache")) {
      if (has("cache") && c.cacheFallback && cacheDown) { fallback = reads; recovered = cacheFail; emit(has("db") ? "db" : "out", reads, 1); }
      else if (has("cache")) emit("cache", reads, 1);
      else emit(has("db") ? "db" : "out", reads, 1);
      emit(has("db") ? "db" : "out", writes, 0);
    } else emit("out", ok, m.readFraction);

    return {
      state: {
        ...s, depth: q.depth, util: capacity > 0 ? q.processed / capacity : 0, errPct: share > 0 && s.bad ? s.bad.err : 0, newShare: share, fallbackRate: fallback / dt, queueWaitMs: q.waitMs,
      },
      outbound: out, dropped, events, recovered,
    };
  },
  sample: (_c, s) => ({
    utilization: clamp(s.util, 0, 1), pods: s.old + s.neu, podsStarting: s.startingOld.reduce((a, p) => a + p.n, 0) + s.startingNew.reduce((a, p) => a + p.n, 0),
    newVersionShare: s.newShare, versionErrorPct: s.errPct * (s.newShare > 0 ? 1 : 0), rolloutState: { idle: 0, rolling: 1, canary: 2, bluegreen: 3, rollingback: 4 }[s.phase], queueWaitMs: s.queueWaitMs, fallbackRate: s.fallbackRate, queueDepth: s.depth,
  }),
});
