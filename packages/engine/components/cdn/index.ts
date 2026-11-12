import { defineComponent } from "../../core/define";
import { clamp, mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config { hitRatio: number; ttlSec: number; edgeLatencyMs: number; originLatencyMs: number; warmupSec: number; costPerHour: number; [k: string]: number }
interface State { warm: number; hit: number; util: number }

export default defineComponent<Config, State>({
  kind: "cdn",
  version: "1.0.0",
  name: "CDN / edge cache",
  description: "Serves cacheable reads from the edge and forwards the rest to the origin.",
  category: "network",
  icon: "cloud",
  ports: [
    { id: "in", direction: "in", label: "Viewers", protocols: ["http"] },
    { id: "origin", direction: "out", label: "Origin", protocols: ["http", "grpc"] },
    { id: "hit", direction: "out", label: "Edge hits", protocols: ["http"], hidden: true },
  ],
  defaults: { hitRatio: 0.92, ttlSec: 300, edgeLatencyMs: 15, originLatencyMs: 0, warmupSec: 60, costPerHour: 0.15 },
  fields: [
    { key: "hitRatio", label: "Steady-state hit ratio", type: "number", min: 0, max: 1, step: 0.01, group: "Caching", help: "A measured input: depends on your content and TTL." },
    { key: "ttlSec", label: "TTL", type: "number", min: 0, max: 86400, step: 10, unit: "s", group: "Caching", help: "Shorter TTL means more origin fetches." },
    { key: "warmupSec", label: "Warm-up after purge", type: "number", min: 1, max: 3600, step: 1, unit: "s", group: "Caching" },
    { key: "costPerHour", label: "Price", type: "number", min: 0, max: 50, step: 0.01, unit: "$/h", group: "Cost" },
    { key: "originLatencyMs", label: "Extra origin-fetch latency", type: "number", min: 0, max: 2000, step: 5, unit: "ms", group: "Latency" },
    { key: "edgeLatencyMs", label: "Edge latency", type: "number", min: 1, max: 500, step: 1, unit: "ms", group: "Latency" },
  ],
  presets: [],
  costPerHour: (c) => c.costPerHour,
  faults: [{ kind: "purge", label: "Purge cache", description: "Invalidate everything; the whole load hits the origin until re-warmed." }],
  derived: (c) => [{ label: "Origin share at steady state", value: `${((1 - c.hitRatio) * 100).toFixed(1)}%`, tone: c.hitRatio < 0.5 ? "warn" : "ok" }],
  metrics: [{ id: "utilization", label: "Origin offload", unit: "%" }, { id: "hitRatio", label: "Hit ratio", unit: "%" }],
  docs: {
    summary: "Edge cache with a configured steady-state hit ratio that dips after a purge and re-warms.",
    models: ["Origin offload from hit ratio", "Purge fault sending full load to origin then linear re-warm"],
    simplifies: ["Hit ratio is an input, not derived from keys", "Single edge location; no tiered caching or request collapsing"],
    failureScenarios: ["Purge sends the full load to origin"],
    references: [{ title: "Amazon CloudFront — Increasing the proportion of requests served from CloudFront caches (cache hit ratio)", url: "https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-hit-ratio.html" }, { title: "Cloudflare — Cache-Control and how edge caches decide freshness", url: "https://developers.cloudflare.com/cache/concepts/cache-control/" }],
  },
  init: () => ({ warm: 1, hit: 0, util: 0 }),
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    let warm = s.warm;
    if (ctx.faults.some((f) => f.kind === "purge" && f.justStarted)) { warm = 0; events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "purged", message: "CDN purged — origin takes full load" }); }
    warm = clamp(warm + ctx.dt / c.warmupSec, 0, 1);
    const ratio = c.hitRatio * warm;
    const reads = m.count * m.readFraction;
    const hits = reads * ratio;
    const lat = m.latencyMs + c.edgeLatencyMs;
    return {
      state: { warm, hit: ratio, util: ratio },
      outbound: [{ port: "hit", count: hits, latencyMs: lat, readFraction: 1 }, { port: "origin", count: m.count - hits, latencyMs: lat + c.originLatencyMs, readFraction: m.count > hits ? (reads - hits) / (m.count - hits) : 0 }],
      dropped: 0, events,
    };
  },
  sample: (_c, s) => ({ utilization: s.util, hitRatio: s.hit }),
});
