import { describe, expect, it } from "vitest";
import {
  ComponentRegistry, Simulation, builtinComponents, builtinProtocols, checkComponentContract, checkConnection,
  createDefaultRegistry, validateGraph, type GraphDoc, type Scenario,
} from "../index";
import { zipfCoverage } from "../components/redis";

const reg = createDefaultRegistry();
const protoIds = builtinProtocols.map((p) => p.id);
const defaults = (kind: string, over = {}) => ({ ...reg.get(kind)!.defaults, ...over });
const scenario = (rps: number, durationSec = 20, over: Partial<Scenario> = {}): Scenario => ({
  name: "t", durationSec, seed: 42, traffic: { type: "constant", rps }, faults: [], ...over,
});
const edge = (id: string, from: string, fromPort: string, to: string, toPort: string, protocol: string) => ({ id, from, fromPort, to, toPort, protocol });

describe("component contract", () => {
  for (const def of builtinComponents) it(`${def.kind} satisfies the contract`, () => expect(checkComponentContract(def, protoIds)).toEqual([]));
  it("detects a broken component", () => {
    const bad = { ...builtinComponents[0]!, kind: "Bad Kind", docs: { ...builtinComponents[0]!.docs, models: [] } };
    expect(checkComponentContract(bad, protoIds).length).toBeGreaterThan(1);
  });
});

describe("registry", () => {
  it("registers, lists and unregisters without touching the engine", () => {
    const r = new ComponentRegistry();
    let calls = 0; r.subscribe(() => calls++);
    r.register(builtinComponents[0]!);
    expect(r.list()).toHaveLength(1);
    expect(() => r.register(builtinComponents[0]!)).toThrow(/already registered/);
    r.unregister("client");
    expect(r.has("client")).toBe(false);
    expect(calls).toBe(2);
  });
  it("supports custom presets", () => {
    const r = createDefaultRegistry();
    r.addPreset("redis", { id: "mine", label: "Mine", version: 1, approximate: true, values: { memoryMB: 64 } });
    expect(r.presetsFor("redis").some((p) => p.id === "mine" && !p.builtin)).toBe(true);
  });
});

describe("connection validation", () => {
  it("accepts compatible and rejects incompatible ports", () => {
    expect(checkConnection(reg, "client", "out", "load-balancer", "in")).toEqual({ ok: true, protocol: "http" });
    const bad = checkConnection(reg, "postgres", "cdc", "ec2", "in");
    expect(bad.ok).toBe(false);
    expect(checkConnection(reg, "ec2", "out", "redis", "in")).toEqual({ ok: true, protocol: "cache-access" });
  });
  it("flags unknown components and bad config", () => {
    const doc: GraphDoc = { nodes: [{ id: "a", kind: "nope", config: {} }, { id: "b", kind: "redis", config: defaults("redis", { memoryMB: -5 }) }], edges: [] };
    const msgs = validateGraph(doc, reg).map((i) => i.message).join("|");
    expect(msgs).toMatch(/Unknown component/);
    expect(msgs).toMatch(/Max memory must be between/);
  });
});

describe("simulation", () => {
  const web: GraphDoc = {
    nodes: [
      { id: "c", kind: "client", config: defaults("client") },
      { id: "lb", kind: "load-balancer", config: defaults("load-balancer") },
      { id: "app", kind: "ec2", config: defaults("ec2", { count: 4, vcpu: 2, burstable: false, cpuCostMs: 10 }) },
    ],
    edges: [edge("e1", "c", "out", "lb", "in", "http"), edge("e2", "lb", "out", "app", "in", "http")],
  };
  it("is deterministic for a seed", () => {
    const a = new Simulation(reg, web, scenario(500)).run();
    const b = new Simulation(reg, web, scenario(500)).run();
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
  it("conserves flow under capacity: throughput ≈ offered", () => {
    const snaps = new Simulation(reg, web, scenario(500)).run();
    const last = snaps[snaps.length - 1]!;
    expect(last.global.throughputRps).toBeCloseTo(500, -1);
    expect(last.global.errorRate).toBe(0);
  });
  it("drops beyond capacity (CPU-bound ceiling = 4*2*1000/10 = 800 rps)", () => {
    const last = new Simulation(reg, web, scenario(2000)).run().at(-1)!;
    expect(last.global.throughputRps).toBeLessThan(850);
    expect(last.global.errorRate).toBeGreaterThan(0.5);
    expect(last.nodes.app!.utilization).toBeGreaterThan(0.95);
  });
  it("t2.micro runs out of CPU credits and throttles to baseline", () => {
    const doc: GraphDoc = {
      nodes: [{ id: "c", kind: "client", config: defaults("client") }, { id: "app", kind: "ec2", config: { ...defaults("ec2"), ...reg.presetsFor("ec2").find((p) => p.id === "t2.micro")!.values, count: 1, cpuCostMs: 10, initialCredits: 1 } }],
      edges: [edge("e", "c", "out", "app", "in", "http")],
    };
    const snaps = new Simulation(reg, doc, scenario(100, 180)).run(1000);
    const early = snaps[5]!.global.throughputRps, late = snaps.at(-1)!.global.throughputRps;
    expect(early).toBeGreaterThan(80); // 1 vCPU bursting handles 100 rps at 10ms
    expect(late).toBeLessThan(15); // 10% baseline => ~10 rps
    expect(snaps.flatMap((s) => s.events).some((e) => e.kind === "credits-exhausted")).toBe(true);
  });
  it("kafka lag grows by (input − capacity) × time", () => {
    const doc: GraphDoc = {
      nodes: [{ id: "c", kind: "client", config: defaults("client") }, { id: "k", kind: "kafka", config: defaults("kafka", { partitions: 6, consumers: 1, consumerRate: 1000, partitionRate: 100000, retentionHours: 1000 }) }],
      edges: [edge("e", "c", "out", "k", "produce", "tcp")],
    };
    const snaps = new Simulation(reg, doc, scenario(3000, 10)).run();
    const lag = snaps.at(-1)!.nodes.k!.lagTotal!;
    expect(lag).toBeGreaterThan(17000); // (3000-1000)*10 = 20000 minus startup tick offset
    expect(lag).toBeLessThan(21000);
  });
  it("kafka idle consumers beyond partitions don't help", () => {
    const mk = (consumers: number) => new Simulation(reg, {
      nodes: [{ id: "c", kind: "client", config: defaults("client") }, { id: "k", kind: "kafka", config: defaults("kafka", { partitions: 4, consumers, consumerRate: 1000, partitionRate: 100000 }) }],
      edges: [edge("e", "c", "out", "k", "produce", "tcp")],
    }, scenario(6000, 10)).run().at(-1)!.nodes.k!.lagTotal!;
    expect(mk(8)).toBeCloseTo(mk(4), -2);
  });
  it("redis hit ratio rises with memory, cold start warms, flush re-colds", () => {
    const doc: GraphDoc = {
      nodes: [
        { id: "c", kind: "client", config: defaults("client", { readRatio: 1 }) },
        { id: "r", kind: "redis", config: defaults("redis", { memoryMB: 1024, keyspace: 100000, avgItemKB: 1, zipfSkew: 1, ttlSec: 0 }) },
        { id: "db", kind: "postgres", config: defaults("postgres", { readQps: 100000 }) },
      ],
      edges: [edge("e1", "c", "out", "r", "in", "http"), edge("e2", "r", "miss", "db", "in", "database")],
    };
    const snaps = new Simulation(reg, doc, scenario(5000, 60, { faults: [{ id: "f", kind: "flush-cache", target: "r", atSec: 40 }] })).run(1000);
    const hit = (i: number) => snaps[i]!.nodes.r!.hitRatio!;
    expect(hit(1)).toBeLessThan(hit(30));
    expect(hit(39)).toBeGreaterThan(0.8);
    expect(hit(40)).toBeLessThan(hit(39) - 0.05);
    expect(snaps.flatMap((s) => s.events).some((e) => e.kind === "cache-flushed")).toBe(true);
  });
  it("kill-node: lb fails over after health-check delay", () => {
    const doc: GraphDoc = {
      nodes: [
        { id: "c", kind: "client", config: defaults("client") },
        { id: "lb", kind: "load-balancer", config: defaults("load-balancer", { checkIntervalSec: 2, unhealthyThreshold: 2 }) },
        { id: "a", kind: "ec2", config: defaults("ec2", { count: 2, vcpu: 4, burstable: false, cpuCostMs: 5 }) },
        { id: "b", kind: "ec2", config: defaults("ec2", { count: 2, vcpu: 4, burstable: false, cpuCostMs: 5 }) },
      ],
      edges: [edge("e1", "c", "out", "lb", "in", "http"), edge("e2", "lb", "out", "a", "in", "http"), edge("e3", "lb", "out", "b", "in", "http")],
    };
    const snaps = new Simulation(reg, doc, scenario(1000, 20, { faults: [{ id: "k", kind: "kill-node", target: "a", atSec: 5 }] })).run(1000);
    expect(snaps[3]!.global.errorRate).toBe(0);
    expect(snaps[5]!.global.errorRate).toBeGreaterThan(0.3); // dead target still receiving
    expect(snaps.at(-1)!.global.errorRate).toBe(0); // failed over
  });
});

describe("algorithms", () => {
  it("zipf coverage: monotonic and bounded", () => {
    expect(zipfCoverage(0, 1000, 1)).toBe(0);
    expect(zipfCoverage(1000, 1000, 1)).toBe(1);
    expect(zipfCoverage(100, 1000, 1)).toBeGreaterThan(zipfCoverage(10, 1000, 1));
    expect(zipfCoverage(100, 1000, 0)).toBeCloseTo(0.1, 1); // uniform
  });
});

describe("template", () => {
  it("passes the contract and a 3rd-party component registers with zero engine changes", async () => {
    const tpl = (await import("../components/_template")).default;
    expect(checkComponentContract(tpl, protoIds)).toEqual([]);
    const r = createDefaultRegistry();
    r.register(tpl);
    const doc: GraphDoc = {
      nodes: [{ id: "c", kind: "client", config: defaults("client") }, { id: "t", kind: "template", config: { ...tpl.defaults, ratePerSec: 100 } }],
      edges: [edge("e", "c", "out", "t", "in", "http")],
    };
    expect(validateGraph(doc, r).filter((i) => i.severity === "error")).toEqual([]);
    const last = new Simulation(r, doc, scenario(500, 10)).run().at(-1)!;
    expect(last.global.throughputRps).toBeLessThan(120);
    r.unregister("template");
    expect(validateGraph(doc, r).some((i) => /Unknown component/.test(i.message))).toBe(true);
  });
});

describe("extended components", () => {
  const run = (doc: GraphDoc, rps: number, dur: number, over: Partial<Scenario> = {}, every = 1000) => new Simulation(reg, doc, scenario(rps, dur, over)).run(every);
  const c = { id: "c", kind: "client", config: defaults("client") };

  it("bloom filter: observed FP rate tracks theory and overfill raises DB load", () => {
    const mk = (loaded: number) => run({
      nodes: [c, { id: "b", kind: "bloom-filter", config: defaults("bloom-filter", { expectedItems: 100000, fpTarget: 0.01, loadedItems: loaded, existsRatio: 0 }) }],
      edges: [edge("e", "c", "out", "b", "in", "http")],
    }, 1000, 30).at(-1)!.nodes.b!;
    const ok = mk(100000), over = mk(300000);
    expect(ok.fpObserved!).toBeLessThan(0.03);
    expect(over.fpObserved!).toBeGreaterThan(ok.fpObserved! * 5);
    expect(over.passRate!).toBeGreaterThan(ok.passRate!);
  });
  it("rate limiter caps sustained throughput; drift lets more through", () => {
    const mk = (drift: number) => run({
      nodes: [c, { id: "r", kind: "rate-limiter", config: defaults("rate-limiter", { limitRps: 500, burst: 50, nodes: 4, driftPct: drift }) }, { id: "s", kind: "ec2", config: defaults("ec2", { count: 20, vcpu: 8, burstable: false, cpuCostMs: 1 }) }],
      edges: [edge("e", "c", "out", "r", "in", "http"), edge("e2", "r", "out", "s", "in", "http")],
    }, 2000, 20).at(-1)!.global.throughputRps;
    expect(mk(0)).toBeCloseTo(500, -2);
    expect(mk(50)).toBeGreaterThan(mk(0) * 1.2);
  });
  it("cdn purge sends load to origin then re-warms", () => {
    const snaps = run({
      nodes: [{ ...c, config: defaults("client", { readRatio: 1 }) }, { id: "cdn", kind: "cdn", config: defaults("cdn", { hitRatio: 0.9, warmupSec: 20 }) }, { id: "o", kind: "ec2", config: defaults("ec2", { count: 20, vcpu: 8, burstable: false, cpuCostMs: 1 }) }],
      edges: [edge("e1", "c", "out", "cdn", "in", "http"), edge("e2", "cdn", "origin", "o", "in", "http")],
    }, 1000, 60, { faults: [{ id: "p", kind: "purge", target: "cdn", atSec: 30 }] });
    expect(snaps[25]!.edges.e2!.rps).toBeCloseTo(100, -1);
    expect(snaps[31]!.edges.e2!.rps).toBeGreaterThan(700);
    expect(snaps[58]!.edges.e2!.rps).toBeLessThan(200);
  });
  it("rabbitmq: fanout multiplies work; low prefetch throttles consumers; no DLX poison loops steal capacity", () => {
    const mk = (cfg: object, rps = 1000, dur = 20) => run({ nodes: [c, { id: "q", kind: "rabbitmq", config: defaults("rabbitmq", cfg) }], edges: [edge("e", "c", "out", "q", "publish", "tcp")] }, rps, dur).at(-1)!.nodes.q!;
    expect(mk({ exchange: "fanout", queues: 3, consumers: 1, consumerRate: 1000 }).ready!).toBeGreaterThan(mk({ exchange: "direct", consumers: 1, consumerRate: 1000 }).ready!);
    expect(mk({ prefetch: 1, consumers: 2, consumerRate: 5000, rttMs: 10 }, 1000).ready!).toBeGreaterThan(1000); // 2 × 1/10ms = 200 msg/s
    const noDlx = mk({ poisonRate: 0.3, dlx: false, consumers: 2, consumerRate: 1000 }, 1500, 30);
    const dlx = mk({ poisonRate: 0.3, dlx: true, consumers: 2, consumerRate: 1000 }, 1500, 30);
    expect(noDlx.ready!).toBeGreaterThan(dlx.ready!);
    expect(dlx.dlq!).toBeGreaterThan(0);
  });
  it("debezium: snapshot delays streaming; stopped connector grows WAL", () => {
    const base = { c, pg: { id: "pg", kind: "postgres", config: defaults("postgres", { writeQps: 100000, readQps: 100000 }) } };
    const mk = (cfg: object, faults: Scenario["faults"] = []) => run({
      nodes: [{ ...base.c, config: defaults("client", { readRatio: 0 }) }, base.pg, { id: "d", kind: "debezium", config: defaults("debezium", cfg) }],
      edges: [edge("e1", "c", "out", "pg", "in", "database"), edge("e2", "pg", "cdc", "d", "source", "cdc")],
    }, 2000, 40, { faults }).at(-1)!.nodes.d!;
    expect(mk({ snapshotMode: "never", connectorRate: 5000 }).lagMs).toBeLessThan(10);
    expect(mk({ snapshotMode: "never", connectorRate: 1000 }).lagMs).toBeGreaterThan(5000); // 1000/s behind for 40 s
    expect(mk({ snapshotMode: "never" }, [{ id: "f", kind: "connector-stop", target: "d", atSec: 10 }]).walMB).toBeGreaterThan(10);
  });
  it("websocket: reconnect jitter softens a deploy storm", () => {
    const mk = (jitter: number) => {
      const snaps = run({
        nodes: [c, { id: "w", kind: "websocket", config: defaults("websocket", { nodes: 2, acceptPerSecPerNode: 500, sessionSec: 3600, reconnectJitterSec: jitter, maxConnsPerNode: 100000 }) }],
        edges: [edge("e", "c", "out", "w", "in", "websocket")],
      }, 1500, 120, { faults: [{ id: "d", kind: "deploy-restart", target: "w", atSec: 80 }] });
      return Math.max(...snaps.filter((s) => s.time > 80).map((s) => s.nodes.w!.rejected!));
    };
    expect(mk(0)).toBeGreaterThan(0);
    expect(mk(30)).toBeLessThanOrEqual(mk(0));
  });
  it("autoscaling group scales out after warm-up and lags a step", () => {
    const snaps = run({
      nodes: [c, { id: "a", kind: "autoscaling-group", config: defaults("autoscaling-group", { minSize: 1, maxSize: 10, count: 1, vcpu: 1, burstable: false, cpuCostMs: 10, cooldownSec: 10, warmupSec: 20, scaleStep: 2, queueLimit: 100 }) }],
      edges: [edge("e", "c", "out", "a", "in", "http")],
    }, 0, 120, { traffic: { type: "step", baseRps: 50, stepRps: 500, atSec: 20 } });
    expect(snaps[10]!.nodes.a!.instances).toBe(1);
    expect(snaps[24]!.global.errorRate).toBeGreaterThan(0.2); // step arrives before capacity
    expect(snaps.at(-1)!.nodes.a!.instances).toBeGreaterThanOrEqual(5);
    expect(snaps.at(-1)!.global.errorRate).toBeLessThan(0.05);
  });
});

describe("algorithms (real)", () => {
  it("bloom sizing and measured FP ≈ theory", async () => {
    const { BloomFilter, bloomParams, bloomFpRate } = await import("../algorithms/bloom");
    const { m, k } = bloomParams(10000, 0.01);
    const f = new BloomFilter(m, k);
    for (let i = 0; i < 10000; i++) f.add(i);
    let fp = 0; for (let i = 0; i < 20000; i++) if (f.has(1e9 + i)) fp++;
    const theory = bloomFpRate(m, k, 10000);
    expect(fp / 20000).toBeGreaterThan(theory * 0.7); // regression: weak hashing once gave ~0.45× theory
    expect(fp / 20000).toBeLessThan(theory * 1.3);
    expect(f.has(5)).toBe(true);
  });
  it("lru/lfu evict as defined; ring shares sum to 1; token bucket bursts then sustains", async () => {
    const { LRUCache, LFUCache, ringShares, TokenBucket } = await import("../algorithms/index");
    const lru = new LRUCache<number>(2); lru.set(1, true); lru.set(2, true); lru.get(1); lru.set(3, true);
    expect(lru.get(2)).toBeUndefined(); expect(lru.get(1)).toBe(true);
    const lfu = new LFUCache<number>(2); lfu.set(1, true); lfu.get(1); lfu.get(1); lfu.set(2, true); lfu.set(3, true);
    expect(lfu.get(1)).toBe(true); expect(lfu.get(2)).toBeUndefined();
    expect(Object.values(ringShares(["a", "b", "c"])).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    const tb = new TokenBucket(10, 100);
    expect(tb.take(100, 0)).toBe(100); expect(tb.take(100, 1)).toBe(10);
  });
});

describe("review regressions", () => {
  const cl = { id: "c", kind: "client", config: defaults("client") };
  const run = (doc: GraphDoc, rps: number, dur: number, over: Partial<Scenario> = {}) => new Simulation(reg, doc, scenario(rps, dur, over)).run(1000);
  it("old designs missing new config fields still run (defaults merged), never NaN", () => {
    const snaps = run({ nodes: [cl, { id: "q", kind: "rabbitmq", config: { exchange: "headers" } }], edges: [edge("e", "c", "out", "q", "publish", "tcp")] }, 500, 10);
    expect(JSON.stringify(snaps.at(-1))).not.toMatch(/null|NaN/);
  });
  it("rejects duplicate node ids; validateGraph flags bad edge numerics, duplicate edges and protocol the target lacks", () => {
    expect(() => new Simulation(reg, { nodes: [cl, cl], edges: [] }, scenario(1, 1))).toThrow(/Duplicate node id/);
    const doc: GraphDoc = { nodes: [cl, { id: "a", kind: "ec2", config: defaults("ec2") }], edges: [{ ...edge("e", "c", "out", "a", "in", "http"), maxRps: -5 }, edge("e", "c", "out", "a", "in", "database")] };
    const msgs = validateGraph(doc, reg).map((i) => i.message).join("|");
    expect(msgs).toMatch(/bandwidth cap/);
    expect(msgs).toMatch(/not supported by both/);
    expect(validateGraph({ ...doc, edges: [doc.edges[0]!, { ...doc.edges[0]!, maxRps: 5 }] }, reg).some((i) => /Duplicate edge id/.test(i.message))).toBe(true);
  });
  it("poison messages without a DLX crowd out good ones; with a DLX they don't", () => {
    const mk = (dlx: boolean) => run({ nodes: [cl, { id: "q", kind: "rabbitmq", config: defaults("rabbitmq", { poisonRate: 0.1, dlx, consumers: 2, consumerRate: 1000, prefetch: 50 }) }], edges: [edge("e", "c", "out", "q", "publish", "tcp")] }, 1500, 60).at(-1)!;
    expect(mk(false).nodes.q!.ready!).toBeGreaterThan(mk(true).nodes.q!.ready! * 5);
    expect(mk(true).global.throughputRps).toBeGreaterThan(mk(false).global.throughputRps);
  });
  it("autoscaling cost follows the live fleet, and a throttled fleet still scales out", () => {
    const snaps = run({ nodes: [cl, { id: "a", kind: "autoscaling-group", config: defaults("autoscaling-group", { minSize: 1, maxSize: 8, cpuCostMs: 10, vcpu: 1, burstable: false, cooldownSec: 5, warmupSec: 5, scaleStep: 2 }) }], edges: [edge("e", "c", "out", "a", "in", "http")] }, 500, 60);
    expect(snaps.at(-1)!.global.costPerHour).toBeGreaterThan(snaps[0]!.global.costPerHour * 2);
  });
  it("an absent/typo'd node metric fails a criterion instead of passing vacuously", async () => {
    const { evaluate } = await import("../index");
    const doc: GraphDoc = { nodes: [cl, { id: "k", kind: "kafka", config: defaults("kafka") }], edges: [edge("e", "c", "out", "k", "produce", "tcp")] };
    const snaps = run(doc, 100, 5);
    const g = evaluate({ id: "x", title: "x", level: "mid", tags: [], summary: "", locked: [], scenario: scenario(1, 1), hints: [], criteria: [{ metric: "kafka.lagTotl", op: "<", value: 100 }] }, snaps, doc);
    expect(g.pass).toBe(false);
  });
  it("lock check is key-order independent and notices a kind swap", async () => {
    const { lockViolations } = await import("../index");
    const ch = { id: "x", title: "", level: "mid", tags: [], summary: "", locked: ["n", "m.a"], scenario: scenario(1, 1), hints: [], criteria: [] } as any;
    const a: GraphDoc = { nodes: [{ id: "n", kind: "ec2", config: { a: 1, b: 2 } }, { id: "m", kind: "ec2", config: { a: 1 } }], edges: [] };
    const reordered: GraphDoc = { nodes: [{ id: "n", kind: "ec2", config: { b: 2, a: 1 } }, { id: "m", kind: "redis", config: { a: 1 } }], edges: [] };
    expect(lockViolations(ch, a, reordered)).toEqual(["m.a"]);
  });
  it("t2 launch credits survive tick 1 even with creditsPerHour 0", () => {
    const snaps = run({ nodes: [cl, { id: "a", kind: "ec2", config: defaults("ec2", { burstable: true, creditsPerHour: 0, initialCredits: 40, count: 1 }) }], edges: [edge("e", "c", "out", "a", "in", "http")] }, 10, 3);
    expect(snaps[0]!.nodes.a!.credits).toBeGreaterThan(30);
  });
});

describe("hashing strategies", () => {
  it("modulo remaps almost everything when a node is added; consistent and rendezvous remap about 1/N", async () => {
    const { remapFraction, rendezvous, HashRing, fnv1a } = await import("../algorithms/index");
    const nodes = ["a", "b", "c", "d", "e"], more = [...nodes, "f"];
    const modulo = (k: number, ns: string[]) => ns[fnv1a(k) % ns.length]!;
    const ring = (k: number, ns: string[]) => new HashRing(ns, 100).lookup(k);
    expect(remapFraction(modulo, nodes, more, 4000)).toBeGreaterThan(0.7);
    expect(remapFraction(ring, nodes, more, 4000)).toBeLessThan(0.3);
    expect(remapFraction(rendezvous, nodes, more)).toBeGreaterThan(0.1);
    expect(remapFraction(rendezvous, nodes, more)).toBeLessThan(0.25);
  });
});
