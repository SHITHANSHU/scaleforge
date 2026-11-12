import { defineComponent } from "../../core/define";

interface Config {
  share: number; readRatio: number; payloadKB: number;
  retries: number; backoffMs: number; backoffMultiplier: number; jitter: number; retryBudgetPct: number;
  [k: string]: number;
}
interface Pending { at: number; n: number; level: number; dup: number }
interface State { pending: Pending[]; sentByLevel: number[]; sentPrev: number[]; sentDup: number; retryRate: number; attempts: number; base: number }

export default defineComponent<Config, State>({
  kind: "client",
  version: "1.1.0",
  name: "Traffic source",
  description: "Generates load from the scenario's traffic profile, optionally retrying failed requests like a real client would.",
  category: "traffic",
  icon: "users",
  ports: [{ id: "out", direction: "out", label: "Requests", protocols: ["http", "grpc", "websocket", "tcp"] }],
  defaults: { share: 100, readRatio: 0.9, payloadKB: 2, retries: 0, backoffMs: 100, backoffMultiplier: 2, jitter: 0.5, retryBudgetPct: 100 },
  fields: [
    { key: "share", label: "Share of scenario load", type: "number", min: 0, max: 100, step: 1, unit: "%", group: "Load", help: "Each source emits scenario RPS × share. With several sources, make the shares sum to 100." },
    { key: "readRatio", label: "Read ratio", type: "number", min: 0, max: 1, step: 0.01, group: "Request mix", help: "Reads can be served from caches and replicas; writes cannot." },
    { key: "payloadKB", label: "Payload size", type: "number", min: 0.1, max: 1024, step: 0.1, unit: "KB", scale: "log", group: "Request mix" },
    { key: "retries", label: "Retries per request", type: "number", min: 0, max: 8, step: 1, group: "Retry policy", help: "0 = fail immediately. Each retry adds load exactly when the system is least able to take it." },
    { key: "backoffMs", label: "Initial backoff", type: "number", min: 1, max: 60000, step: 10, unit: "ms", scale: "log", group: "Retry policy", help: "Delay before the first retry." },
    { key: "backoffMultiplier", label: "Backoff multiplier", type: "number", min: 1, max: 4, step: 0.1, group: "Retry policy", help: "1 = fixed delay; 2 = exponential." },
    { key: "jitter", label: "Jitter", type: "number", min: 0, max: 1, step: 0.05, group: "Retry policy", help: "Randomises delays so retries do not arrive in synchronized waves." },
    { key: "retryBudgetPct", label: "Retry budget", type: "number", min: 0, max: 100, step: 1, unit: "% of base", group: "Retry policy", help: "Cap retry traffic at this share of first-try traffic. 100 = effectively unbounded." },
  ],
  presets: [
    { id: "no-retry", label: "No retries", version: 1, approximate: false, source: { title: "Baseline: retries disabled" }, builtin: true, values: { retries: 0 } },
    { id: "naive-retry", label: "Naive: 3 retries, fixed delay", version: 1, approximate: true, source: { title: "Illustrative; see AWS Builders' Library: Timeouts, retries and backoff with jitter" }, builtin: true, values: { retries: 3, backoffMs: 100, backoffMultiplier: 1, jitter: 0, retryBudgetPct: 100 } },
    { id: "polite-retry", label: "Backoff + jitter + 10% budget", version: 1, approximate: true, source: { title: "Illustrative; see AWS Builders' Library and Google SRE book (retry budgets)" }, builtin: true, values: { retries: 3, backoffMs: 100, backoffMultiplier: 2, jitter: 1, retryBudgetPct: 10 } },
  ],
  derived: (c) => c.retries > 0 ? [
    { label: "Worst-case load multiplier", value: `${(1 + Math.min(c.retries, c.retryBudgetPct / 100 * c.retries)).toFixed(1)}×`, tone: c.retryBudgetPct >= 100 && c.retries >= 3 ? "warn" : "ok", help: "When everything fails, each request is sent up to 1 + retries times (less with a budget)." },
  ] : [],
  metrics: [{ id: "utilization", label: "Utilization", unit: "%" }, { id: "retryRate", label: "Retry traffic", unit: "req/s" }, { id: "attempts", label: "Attempts per request", unit: "×" }],
  docs: {
    summary: "Open-loop load generator with an optional client retry policy.",
    models: ["Constant, ramp, step and spike profiles from the scenario", "Read/write mix carried downstream", "Retries on failure with exponential backoff, jitter and a retry budget", "Retried traffic counted separately from offered load, so amplification is visible", "Retries after client-side timeouts are marked as possible duplicates"],
    simplifies: ["No closed-loop users or think time", "Failures are learned one tick after they occur and attributed proportionally across retry attempts", "A failure is any rejection or timeout; no distinction between retryable and non-retryable errors", "Retry timing is tracked in aggregate, not per request"],
    failureScenarios: ["Retry storm: a brief slowdown becomes sustained overload", "Synchronized retries without jitter", "Duplicate side effects when a timed-out request is retried"],
    references: [{ title: "AWS Builders' Library: Timeouts, retries and backoff with jitter", url: "https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/" }, { title: "Google SRE book: Addressing cascading failures", url: "https://sre.google/sre-book/addressing-cascading-failures/" }],
  },
  init: () => ({ pending: [], sentByLevel: [], sentPrev: [], sentDup: 0, retryRate: 0, attempts: 1, base: 0 }),
  tick(ctx, c, s) {
    const base = ((ctx.rps * c.share) / 100) * ctx.dt;
    const pending = s.pending.filter((p) => p.n > 1e-9);
    let recovered = 0;

    // learn from last tick's outcomes and schedule retries
    if (c.retries > 0) {
      let sent = 0, failed = 0, timedOut = 0;
      for (const es of Object.values(ctx.outEdges)) for (const id of es) { const f = ctx.feedback(id); sent += f.sent; failed += f.failed; timedOut += f.timedOut; }
      const failFrac = sent > 0 ? Math.min(1, failed / sent) : 0;
      const dupShare = failed > 0 ? Math.min(1, timedOut / failed) : 0;
      // outcomes reported now describe what was sent two ticks ago (send → process → report)
      let remaining = (c.retryBudgetPct / 100) * Math.max(base, s.base);
      for (let k = 0; k < s.sentPrev.length; k++) {
        const failedK = (s.sentPrev[k] ?? 0) * failFrac;
        if (failedK <= 0 || k >= c.retries) continue;
        const allow = Math.max(0, Math.min(failedK, remaining));
        if (allow <= 0) continue;
        remaining -= allow; recovered += allow;
        const delay = (c.backoffMs / 1000) * Math.pow(c.backoffMultiplier, k) * (1 + c.jitter * (ctx.rng.next() * 2 - 1));
        pending.push({ at: ctx.time + Math.max(ctx.dt, delay), n: allow, level: k + 1, dup: dupShare });
      }
    }

    // emit first tries plus retries that are due
    const due = pending.filter((p) => p.at <= ctx.time);
    const later = pending.filter((p) => p.at > ctx.time);
    const sentByLevel: number[] = [base];
    let retryCount = 0, dupCount = 0, waitedMs = 0;
    for (const p of due) {
      sentByLevel[p.level] = (sentByLevel[p.level] ?? 0) + p.n; retryCount += p.n; dupCount += p.n * p.dup;
      // the user has been waiting through every earlier attempt and backoff
      let w = 0; for (let j = 0; j < p.level; j++) w += c.backoffMs * Math.pow(c.backoffMultiplier, j);
      waitedMs += p.n * w;
    }
    for (let i = 0; i < sentByLevel.length; i++) sentByLevel[i] = sentByLevel[i] ?? 0;
    const total = base + retryCount;
    return {
      state: { pending: later, sentByLevel, sentPrev: s.sentByLevel, sentDup: dupCount, retryRate: retryCount / ctx.dt, attempts: base > 0 ? total / base : 1, base },
      dropped: 0, events: [], recovered,
      outbound: [{ port: "out", count: total, latencyMs: total > 0 ? waitedMs / total : 0, readFraction: c.readRatio, retryCount, dupFraction: total > 0 ? dupCount / total : 0 }],
    };
  },
  sample: (_c, s) => ({ utilization: 0, retryRate: s.retryRate, attempts: s.attempts }),
});
