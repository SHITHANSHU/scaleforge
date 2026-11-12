import { defineComponent } from "../../core/define";
import { clamp, mergeInflows } from "../../core/flow";
import { BloomFilter, bloomFpRate, bloomParams } from "../../algorithms/bloom";
import type { SimEvent } from "../../core/types";

interface Config { expectedItems: number; fpTarget: number; loadedItems: number; insertsPerSec: number; existsRatio: number; lookupMs: number; [k: string]: number }
interface State { filter: BloomFilter; scale: number; items: number; probes: number; fps: number; passRate: number; warned: boolean; util: number }

const MAX_BITS = 1 << 22; // real filter is capped; larger designs are simulated at a proportional scale

const source = { title: "Bloom (1970); RedisBloom docs — sizing formulas m = -n ln p / (ln 2)², k = (m/n) ln 2", url: "https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/" };

export default defineComponent<Config, State>({
  kind: "bloom-filter",
  version: "1.0.0",
  name: "Bloom filter",
  description: "Probabilistic membership test in front of a database. Real filter on sampled keys; observed vs theoretical false-positive rate.",
  category: "cache",
  icon: "filter",
  ports: [
    { id: "in", direction: "in", label: "Lookups", protocols: ["cache-access", "tcp", "http"] },
    { id: "maybe", direction: "out", label: "Maybe present", protocols: ["database", "http", "grpc"] },
    { id: "no", direction: "out", label: "Definitely absent", protocols: ["cache-access"], hidden: true },
  ],
  defaults: { expectedItems: 1_000_000, fpTarget: 0.01, loadedItems: 500_000, insertsPerSec: 0, existsRatio: 0.2, lookupMs: 0.3 },
  fields: [
    { key: "expectedItems", label: "Expected items (n)", type: "number", min: 1000, max: 1e9, step: 1000, scale: "log", group: "Sizing", help: "Sizes the bit array. Inserting more than this inflates false positives." },
    { key: "fpTarget", label: "False-positive target (p)", type: "number", min: 0.0001, max: 0.3, step: 0.0001, scale: "log", group: "Sizing" },
    { key: "loadedItems", label: "Items already inserted", type: "number", min: 0, max: 2e9, step: 1000, group: "Fill" },
    { key: "insertsPerSec", label: "New inserts", type: "number", min: 0, max: 100000, step: 10, unit: "/s", group: "Fill", help: "Bloom filters cannot delete; the fill only grows." },
    { key: "existsRatio", label: "Lookups for existing keys", type: "number", min: 0, max: 1, step: 0.01, group: "Workload", help: "The rest are absent keys — the traffic the filter should shield the DB from." },
    { key: "lookupMs", label: "Lookup latency", type: "number", min: 0.01, max: 20, step: 0.01, unit: "ms", group: "Workload" },
  ],
  presets: [
    { id: "usernames", label: "Username availability (1M, 1%)", version: 1, approximate: true, source, builtin: true, values: { expectedItems: 1_000_000, fpTarget: 0.01, loadedItems: 400_000, existsRatio: 0.15 } },
    { id: "tight", label: "Tight (10M, 0.1%)", version: 1, approximate: true, source, builtin: true, values: { expectedItems: 10_000_000, fpTarget: 0.001, loadedItems: 5_000_000 } },
  ],
  derived(c) {
    const { m, k } = bloomParams(c.expectedItems, c.fpTarget);
    const fp = bloomFpRate(m, k, c.loadedItems);
    return [
      { label: "Bits (m)", value: m.toLocaleString(), help: `${(m / 8 / 1024).toFixed(0)} KB` },
      { label: "Hash functions (k)", value: String(k) },
      { label: "False-positive rate at current fill", value: `${(fp * 100).toFixed(2)}%`, tone: fp > c.fpTarget * 2 ? "bad" : fp > c.fpTarget * 1.2 ? "warn" : "ok", help: c.loadedItems > c.expectedItems ? "Overfilled past n — rate degrades fast." : undefined },
    ];
  },
  faults: [],
  metrics: [
    { id: "utilization", label: "Fill vs capacity", unit: "%" },
    { id: "fpTheory", label: "FP rate (theory)", unit: "%" },
    { id: "fpObserved", label: "FP rate (observed)", unit: "%" },
    { id: "passRate", label: "Passed to DB", unit: "%" },
  ],
  docs: {
    summary: "Shields a database from lookups of keys that do not exist. Absent keys are rejected locally; present keys and false positives pass through.",
    models: ["A real Bloom filter runs on sampled keys, so observed false-positive rate is measured, not assumed", "Sizing m and k from n and p", "Overfilling past n", "Fraction of traffic reaching the DB"],
    simplifies: ["Filter is scaled down to ≤4M bits and keys are sampled; ratios are preserved", "No counting/cuckoo variants, so no deletes", "No persistence or rebuild cost"],
    failureScenarios: ["Inserting past n raises the false-positive rate and DB load", "Under-sizing p sends more absent-key traffic to the DB"],
    references: [{ title: "Bloom filter (Wikipedia)", url: "https://en.wikipedia.org/wiki/Bloom_filter" }],
  },
  init(c) {
    const { m, k } = bloomParams(c.expectedItems, c.fpTarget);
    const scale = Math.max(1, m / MAX_BITS);
    const f = new BloomFilter(Math.ceil(m / scale), k);
    const n = Math.min(Math.floor(c.loadedItems / scale), 2_000_000);
    for (let i = 0; i < n; i++) f.add(i);
    return { filter: f, scale, items: c.loadedItems, probes: 0, fps: 0, passRate: 0, warned: false, util: c.loadedItems / c.expectedItems };
  },
  validate: (c, v) => [
    ...(v.outgoing.length === 0 ? [{ severity: "warn" as const, message: "Nothing behind the filter — connect “maybe present” to a database" }] : []),
    ...(c.loadedItems > c.expectedItems ? [{ severity: "warn" as const, field: "loadedItems", message: "Loaded items exceed n: false-positive rate is above target" }] : []),
  ],
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const items = s.items + c.insertsPerSec * ctx.dt;
    // keep the real filter in step with the (scaled) item count
    const target = Math.min(Math.floor(items / s.scale), 3_000_000);
    while (s.filter.count < target && s.filter.count < s.filter.m) s.filter.add(s.filter.count);
    // probe a few absent keys to measure the observed FP rate
    let { probes, fps } = s;
    for (let i = 0; i < 20; i++) { probes++; if (s.filter.has(0x40000000 + Math.floor(ctx.rng.next() * 1e9))) fps++; }
    const fpObs = probes > 0 ? fps / probes : 0;
    const absent = m.count * (1 - c.existsRatio);
    const pass = m.count * c.existsRatio + absent * fpObs;
    const warned = s.warned || items > c.expectedItems;
    if (!s.warned && items > c.expectedItems) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "warn", kind: "overfilled", message: "Bloom filter exceeded expected items — false positives rising" });
    const lat = m.latencyMs + c.lookupMs;
    return {
      state: { ...s, items, probes: probes > 1e6 ? probes / 2 : probes, fps: probes > 1e6 ? fps / 2 : fps, passRate: m.count > 0 ? pass / m.count : s.passRate, warned, util: items / c.expectedItems },
      outbound: [
        { port: "maybe", count: pass, latencyMs: lat, readFraction: 1 },
        { port: "no", count: m.count - pass, latencyMs: lat, readFraction: 1 },
      ],
      dropped: 0, events,
    };
  },
  sample: (_c, s) => ({ utilization: clamp(s.util, 0, 1), fpTheory: bloomFpRate(s.filter.m, s.filter.k, s.filter.count), fpObserved: s.probes ? s.fps / s.probes : 0, passRate: s.passRate }),
});
