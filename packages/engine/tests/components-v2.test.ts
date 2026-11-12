import { describe, expect, it } from "vitest";
import { createDefaultRegistry, Simulation, type GraphDoc, type Scenario } from "../index";

const reg = createDefaultRegistry();
const d = (kind: string, over = {}) => ({ ...reg.get(kind)!.defaults, ...over });
const sc = (rps: number, dur: number, faults: Scenario["faults"] = [], over: Partial<Scenario> = {}): Scenario => ({ name: "t", durationSec: dur, seed: 5, traffic: { type: "constant", rps }, faults, ...over });
const run = (g: GraphDoc, s: Scenario) => new Simulation(reg, g, s).run(1000);
const edge = (id: string, from: string, fp: string, to: string, tp: string, protocol: string) => ({ id, from, fromPort: fp, to, toPort: tp, protocol });
const total = (r: ReturnType<typeof run>) => r.reduce((a, x) => a + x.global.droppedRps, 0) / Math.max(1, r.reduce((a, x) => a + x.global.droppedRps + x.global.throughputRps, 0));

describe("api-gateway", () => {
  /** client → gateway → app(1000 rps) that fails hard for 20 s */
  const g = (gw = {}, client = {}): GraphDoc => ({
    nodes: [
      { id: "c", kind: "client", config: d("client", { readRatio: 1, ...client }) },
      { id: "gw", kind: "api-gateway", config: d("api-gateway", gw) },
      { id: "app", kind: "ec2", config: d("ec2", { count: 2, vcpu: 5, burstable: false, cpuCostMs: 10, queueLimit: 100, networkMbps: 25000 }) },
    ],
    edges: [edge("e1", "c", "out", "gw", "in", "http"), edge("e2", "gw", "out", "app", "in", "http")],
  });
  it("shedding by queue age keeps latency bounded under overload; no shedding lets the queue age explode", () => {
    const shed = run(g({ shedding: true, maxQueueAgeMs: 100, capacityRps: 1000, breaker: false }), sc(1600, 30));
    const noShed = run(g({ shedding: false, queueLimit: 200000, capacityRps: 1000, breaker: false }), sc(1600, 30));
    expect(shed.at(-1)!.global.p99).toBeLessThan(500);
    expect(noShed.at(-1)!.global.p99).toBeGreaterThan(5000);
  });
  it("circuit breaker opens on upstream failure, fails fast, and closes after recovery", () => {
    const outage = [{ id: "k", kind: "kill-node", target: "app", atSec: 10, untilSec: 30 }];
    const r = run(g({ breaker: true, openSec: 5, tripErrorPct: 50, capacityRps: 5000 }), sc(500, 80, outage));
    const kinds = r.flatMap((x) => x.events).map((e) => e.kind);
    expect(kinds).toContain("breaker-open");
    expect(kinds).toContain("breaker-closed");
    expect(r.at(-1)!.nodes.gw!.breakerState).toBe(0);
    // while open, the upstream sees far less traffic than offered
    const upstream = r[20]!.edges.e2!.rps;
    expect(upstream).toBeLessThan(120);
  });
  it("a breaker protects a recovering dependency from the retry stampede", () => {
    const outage = [{ id: "k", kind: "kill-node", target: "app", atSec: 10, untilSec: 25 }];
    const retry = { retries: 3, backoffMs: 100, backoffMultiplier: 1, jitter: 0 };
    const withB = run(g({ breaker: true, openSec: 5, capacityRps: 20000 }, retry), sc(800, 80, outage));
    const without = run(g({ breaker: false, capacityRps: 20000 }, retry), sc(800, 80, outage));
    const peak = (r: ReturnType<typeof run>) => Math.max(...r.filter((x) => x.time > 25).map((x) => x.edges.e2!.rps));
    expect(peak(withB)).toBeLessThanOrEqual(peak(without));
  });
});

describe("idempotency-store", () => {
  /** client with timeouts+retries → store → payment sink (ec2). Slow edge makes clients time out and retry. */
  const g = (store = {}, extra: Partial<GraphDoc> = {}): GraphDoc => ({
    nodes: [
      { id: "c", kind: "client", config: d("client", { readRatio: 0, retries: 2, backoffMs: 200, backoffMultiplier: 1, jitter: 0 }) },
      { id: "idem", kind: "idempotency-store", config: d("idempotency-store", store) },
      { id: "pay", kind: "ec2", config: d("ec2", { count: 4, vcpu: 4, burstable: false, cpuCostMs: 5, networkMbps: 25000 }) },
    ],
    edges: [edge("e1", "c", "out", "idem", "in", "http"), edge("e2", "idem", "out", "pay", "in", "http")],
    ...extra,
  });
  const slow = [{ id: "l", kind: "edge-latency", target: "e2", atSec: 5, untilSec: 25, params: { addMs: 900 } }];
  const dup = (r: ReturnType<typeof run>) => Math.max(...r.map((x) => x.global.duplicateRate));
  it("duplicates reach the payment sink without a dedup store window; a long window absorbs them", () => {
    const short = run(g({ windowSec: 1, dupDelaySec: 30 }), sc(300, 40, slow, { timeoutMs: 600 }));
    const long = run(g({ windowSec: 600, dupDelaySec: 30 }), sc(300, 40, slow, { timeoutMs: 600 }));
    expect(dup(short)).toBeGreaterThan(0.01);
    expect(dup(long)).toBeLessThan(dup(short) / 5);
  });
  it("a store outage fails open (duplicates) or closed (errors), by choice", () => {
    const brief = [{ id: "l", kind: "edge-latency", target: "e2", atSec: 5, untilSec: 15, params: { addMs: 900 } }];
    const down = [...brief, { id: "d", kind: "store-down", target: "idem", atSec: 14, untilSec: 30 }]; // retries land while the store is down
    const open = run(g({ windowSec: 600, dupDelaySec: 30, failOpen: true }), sc(300, 40, down, { timeoutMs: 600 }));
    const closed = run(g({ windowSec: 600, dupDelaySec: 30, failOpen: false }), sc(300, 40, down, { timeoutMs: 600 }));
    expect(dup(open)).toBeGreaterThan(0.01);
    expect(total(closed)).toBeGreaterThan(total(open));
  });
});

describe("quorum-kv", () => {
  const g = (kv = {}, client = {}): GraphDoc => ({
    nodes: [{ id: "c", kind: "client", config: d("client", { readRatio: 0.7, ...client }) }, { id: "kv", kind: "quorum-kv", config: d("quorum-kv", kv) }],
    edges: [edge("e", "c", "out", "kv", "in", "tcp")],
  });
  const fail = (index: number, atSec = 5) => [{ id: `f${index}`, kind: "fail-node", target: "kv", atSec, params: { index } }];
  it("CL=ALL loses availability with one node down; quorum survives it; CL=ONE survives two", () => {
    const base = { rf: 3, nodes: 6 };
    const all = run(g({ ...base, readCL: "all", writeCL: "all" }), sc(2000, 20, fail(0)));
    const quorum = run(g({ ...base, readCL: "quorum", writeCL: "quorum" }), sc(2000, 20, fail(0)));
    const two = [...fail(0), ...fail(1)];
    const quorum2 = run(g({ ...base, readCL: "quorum", writeCL: "quorum" }), sc(2000, 20, two));
    const one2 = run(g({ ...base, readCL: "one", writeCL: "one" }), sc(2000, 20, two));
    expect(all.at(-1)!.nodes.kv!.availability!).toBeLessThan(0.7);
    expect(quorum.at(-1)!.nodes.kv!.availability).toBe(1);
    expect(quorum2.at(-1)!.nodes.kv!.availability!).toBeLessThan(1);
    expect(one2.at(-1)!.nodes.kv!.availability!).toBeGreaterThan(quorum2.at(-1)!.nodes.kv!.availability!);
  });
  it("R+W>RF is strongly consistent; R=W=ONE shows stale reads after trouble", () => {
    const strong = run(g({ readCL: "quorum", writeCL: "quorum" }), sc(2000, 20, fail(0)));
    const eventual = run(g({ readCL: "one", writeCL: "one" }), sc(2000, 20, fail(0)));
    expect(strong.at(-1)!.nodes.kv!.staleReadRate).toBe(0);
    expect(eventual.at(-1)!.nodes.kv!.staleReadRate!).toBeGreaterThan(0.05);
  });
  it("a hot key saturates its replica set while the cluster looks idle; more nodes do not help", () => {
    const hot = run(g({ nodes: 6, hotKeyShare: 0.6, nodeQps: 1500 }), sc(5000, 20)).at(-1)!;
    const bigger = run(g({ nodes: 24, hotKeyShare: 0.6, nodeQps: 1500 }), sc(5000, 20)).at(-1)!;
    expect(hot.nodes.kv!.hotUtil!).toBeGreaterThan(0.95);
    expect(bigger.nodes.kv!.hotUtil!).toBeGreaterThan(0.95);
    expect(bigger.global.errorRate).toBeGreaterThan(0.1);
    const spread = run(g({ nodes: 6, hotKeyShare: 0.05, nodeQps: 3000 }), sc(5000, 20)).at(-1)!;
    expect(spread.global.errorRate).toBeLessThan(0.02);
  });
  it("hints accumulate during an outage, expire past the window, and are replayed after recovery", () => {
    const outage = [{ id: "f", kind: "fail-node", target: "kv", atSec: 5, untilSec: 40, params: { index: 0 } }];
    const r = run(g({ hintWindowSec: 100, hintReplayQps: 200 }), sc(3000, 120, outage));
    expect(r[30]!.nodes.kv!.hintBacklog!).toBeGreaterThan(1000);
    expect(r.at(-1)!.nodes.kv!.hintBacklog!).toBeLessThan(r[39]!.nodes.kv!.hintBacklog!);
    const long = [{ id: "f", kind: "fail-node", target: "kv", atSec: 5, params: { index: 0 } }];
    const lost = run(g({ hintWindowSec: 20 }), sc(3000, 60, long));
    expect(lost.at(-1)!.nodes.kv!.dataLoss!).toBeGreaterThan(0);
  });
});

describe("search-cluster", () => {
  const mk = (cfg = {}, qShare = 100, iRps = 0): { doc: GraphDoc; rps: number } => ({
    rps: 1000,
    doc: {
      nodes: [
        { id: "q", kind: "client", config: d("client", { readRatio: 1, share: qShare }) },
        { id: "i", kind: "client", config: d("client", { readRatio: 0, share: iRps / 10 }) },
        { id: "s", kind: "search-cluster", config: d("search-cluster", cfg) },
      ],
      edges: [edge("e1", "q", "out", "s", "query", "http"), edge("e2", "i", "out", "s", "index", "http")],
    },
  });
  it("a bulk re-import (indexing burst) starves live queries and delays freshness", () => {
    const quiet = mk({ dataNodes: 3, nodeCpu: 4 }, 100, 0);
    const bulk = mk({ dataNodes: 3, nodeCpu: 4 }, 100, 9000);
    const a = run(quiet.doc, sc(quiet.rps, 30)).at(-1)!.nodes.s!;
    const b = run(bulk.doc, sc(bulk.rps, 30)).at(-1)!.nodes.s!;
    expect(b.latencyMs!).toBeGreaterThan(a.latencyMs! * 2);
    expect(b.indexLagSec!).toBeGreaterThan(a.indexLagSec! + 1);
  });
  it("both under-sharding and over-sharding hurt query latency", () => {
    const lat = (shards: number) => { const m = mk({ shards, docsMillions: 400, dataNodes: 6, nodeCpu: 8 }); return run(m.doc, sc(60, 20)).at(-1)!.nodes.s!.latencyMs!; };
    const few = lat(2), ok = lat(24), many = lat(400);
    expect(few).toBeGreaterThan(ok);
    expect(many).toBeGreaterThan(ok);
  });
  it("no replicas + node loss = partial results (errors); a replica masks it", () => {
    const loss = [{ id: "f", kind: "fail-node", target: "s", atSec: 5, params: { index: 0 } }];
    const noRep = mk({ replicas: 0, dataNodes: 4 }); const rep = mk({ replicas: 1, dataNodes: 4 });
    expect(run(noRep.doc, sc(150, 20, loss)).at(-1)!.global.errorRate).toBeGreaterThan(0.15);
    expect(run(rep.doc, sc(150, 20, loss)).at(-1)!.global.errorRate).toBeLessThan(0.1);
  });
  it("a longer refresh interval lowers indexing cost but raises staleness", () => {
    const f = (refreshSec: number) => run(mk({ refreshSec }, 100, 2000).doc, sc(1000, 20)).at(-1)!.nodes.s!;
    expect(f(30).freshnessSec!).toBeGreaterThan(f(1).freshnessSec!);
    expect(f(30).indexUtil!).toBeLessThan(f(1).indexUtil!);
  });
});
