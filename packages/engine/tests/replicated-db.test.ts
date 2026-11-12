import { describe, expect, it } from "vitest";
import { createDefaultRegistry, Simulation, type GraphDoc, type Scenario } from "../index";

const reg = createDefaultRegistry();
const d = (kind: string, over = {}) => ({ ...reg.get(kind)!.defaults, ...over });
const sc = (rps: number, dur: number, faults: Scenario["faults"] = [], over: Partial<Scenario> = {}): Scenario => ({ name: "t", durationSec: dur, seed: 7, traffic: { type: "constant", rps }, faults, ...over });
const doc = (cfg = {}, clientCfg = {}): GraphDoc => ({
  nodes: [{ id: "c", kind: "client", config: d("client", { readRatio: 0.8, ...clientCfg }) }, { id: "db", kind: "replicated-db", config: d("replicated-db", { readQps: 4000, writeQps: 2000, ...cfg }) }],
  edges: [{ id: "e", from: "c", fromPort: "out", to: "db", toPort: "in", protocol: "database" }],
});
const run = (g: GraphDoc, s: Scenario) => new Simulation(reg, g, s).run(1000);
const last = (r: ReturnType<typeof run>) => r.at(-1)!.nodes.db!;
const events = (r: ReturnType<typeof run>) => r.flatMap((x) => x.events);

describe("replicated-db: replication and reads", () => {
  it("replica lag grows when writes exceed the apply rate and stale reads follow", () => {
    const slow = run(doc({ applyQps: 300 }), sc(3000, 30)); // 600 writes/s vs 300 apply
    expect(last(slow).replicaLagSec!).toBeGreaterThan(5);
    expect(last(slow).staleReadRate!).toBeGreaterThan(0.1);
    const fast = run(doc({ applyQps: 5000 }), sc(3000, 30));
    expect(last(fast).replicaLagSec!).toBeLessThan(0.05);
    expect(last(fast).staleReadRate!).toBeLessThan(0.02);
  });
  it("lag-aware routing trades staleness for primary load; primary-only is always fresh", () => {
    const base = { applyQps: 300 };
    const rep = last(run(doc({ ...base, readRouting: "replicas" }), sc(3000, 30)));
    const aware = last(run(doc({ ...base, readRouting: "lag-aware", maxStalenessSec: 1 }), sc(3000, 30)));
    const prim = last(run(doc({ ...base, readRouting: "primary" }), sc(3000, 30)));
    expect(aware.staleReadRate!).toBeLessThan(rep.staleReadRate!);
    expect(prim.staleReadRate).toBe(0);
  });
  it("losing a replica at peak overloads the survivors", () => {
    const g = doc({ replicas: 2, readQps: 2000, writeQps: 5000 });
    const ok = run(g, sc(5000, 40));
    const hit = run(g, sc(5000, 40, [{ id: "f", kind: "fail-node", target: "db", atSec: 10, params: { index: 1 } }]));
    expect(ok.at(-1)!.global.errorRate).toBeLessThan(0.02);
    expect(hit.at(-1)!.global.errorRate).toBeGreaterThan(ok.at(-1)!.global.errorRate + 0.03);
  });
});

describe("replicated-db: failover", () => {
  const fail = [{ id: "f", kind: "fail-node", target: "db", atSec: 10 }];
  it("async failover: write outage = detect + promote, reads continue, lag window lost", () => {
    const r = run(doc({ applyQps: 5000, detectSec: 5, promoteSec: 10, replicas: 2, shipLagSec: 1 }), sc(2500, 60, fail));
    const w = r.map((x) => x.nodes.db!.writeAvailable!);
    expect(w[8]).toBe(1);
    expect(w[12]).toBe(0);
    expect(w[30]).toBe(1);
    expect(last(r).downtimeSec!).toBeGreaterThan(13);
    expect(last(r).downtimeSec!).toBeLessThan(18);
    expect(last(r).dataLoss!).toBeGreaterThan(300); // ≈ 1 s × 500 writes/s of unshipped log
    expect(last(r).dataLoss!).toBeLessThan(700);
    expect(events(r).some((e) => e.kind === "promoted")).toBe(true);
  });
  it("synchronous replication loses nothing on failover but adds commit latency", () => {
    const g = { applyQps: 400, detectSec: 5, promoteSec: 10, replicas: 2, replication: "sync", syncCopies: 1, syncRttMs: 20 };
    const r = run(doc(g), sc(2500, 60, fail));
    expect(last(r).dataLoss).toBe(0);
    const base = run(doc({ ...g, replication: "async" }), sc(2500, 20));
    const sync = run(doc(g), sc(2500, 20));
    expect(sync.at(-1)!.global.p50).toBeGreaterThan(base.at(-1)!.global.p50);
  });
  it("synchronous quorum stalls writes when too few copies are reachable", () => {
    const g = doc({ replicas: 1, replication: "sync", syncCopies: 1 });
    const r = run(g, sc(1000, 30, [{ id: "f", kind: "fail-node", target: "db", atSec: 5, params: { index: 1 } }]));
    expect(last(r).writeAvailable).toBe(0);
  });
  it("manual failover leaves a much longer write outage than automatic", () => {
    const auto = last(run(doc({ failover: "auto", detectSec: 5, promoteSec: 10 }), sc(1000, 120, fail)));
    const manual = last(run(doc({ failover: "manual", manualResponseSec: 90, promoteSec: 10 }), sc(1000, 120, fail)));
    expect(manual.downtimeSec!).toBeGreaterThan(auto.downtimeSec! * 4);
  });
  it("queueing during failover trades errors for latency", () => {
    const g = { detectSec: 5, promoteSec: 10 };
    const total = (r: ReturnType<typeof run>) => r.reduce((a, x) => a + x.global.droppedRps, 0) / r.reduce((a, x) => a + x.global.droppedRps + x.global.throughputRps, 0);
    const plain = run(doc(g), sc(800, 40, fail));
    const queued = run(doc({ ...g, queueDuringFailover: true, queueLimit: 50000 }), sc(800, 40, fail));
    expect(total(plain)).toBeGreaterThan(0.05);
    expect(total(queued)).toBeLessThan(total(plain) / 3);
  });
  it("no replicas: primary failure is an outage until it returns", () => {
    const r = run(doc({ replicas: 0 }), sc(500, 40, [{ id: "f", kind: "fail-node", target: "db", atSec: 5, untilSec: 25 }]));
    expect(r[10]!.nodes.db!.writeAvailable).toBe(0);
    expect(last(r).writeAvailable).toBe(1);
  });
});

describe("replicated-db: split brain", () => {
  const part = [{ id: "p", kind: "partition-primary", target: "db", atSec: 10, untilSec: 50, params: { clientShare: 0.5 } }];
  it("without fencing, a partition creates divergent writes; with fencing it does not", () => {
    const g = { detectSec: 5, promoteSec: 5, applyQps: 5000 };
    const nofence = run(doc({ ...g, fencing: false }), sc(2000, 70, part));
    const fenced = run(doc({ ...g, fencing: true }), sc(2000, 70, part));
    expect(last(nofence).divergentWrites!).toBeGreaterThan(5000);
    expect(last(fenced).divergentWrites).toBe(0);
    expect(events(nofence).some((e) => /SPLIT BRAIN/.test(e.message))).toBe(true);
  });
});

describe("replicated-db: backups and recovery", () => {
  const bad = (extra = {}) => [{ id: "b", kind: "bad-write", target: "db", atSec: 100, params: { detectSec: 60, ...extra } }];
  const g = { snapshotIntervalSec: 120, dataGB: 60, restoreMBps: 100 };
  it("restoring from snapshot loses writes since the snapshot; PITR loses only post-corruption writes", () => {
    const snap = last(run(doc(g), sc(1000, 900, bad())));
    const pitr = last(run(doc({ ...g, walArchive: true }), sc(1000, 900, bad())));
    expect(snap.dataLoss!).toBeGreaterThan(pitr.dataLoss! * 1.5);
    expect(pitr.dataLoss!).toBeGreaterThan(0);
  });
  it("restore causes a write outage proportional to data size ÷ throughput", () => {
    const small = last(run(doc({ ...g, dataGB: 20 }), sc(500, 1200, bad())));
    const big = last(run(doc({ ...g, dataGB: 100 }), sc(500, 1800, bad())));
    expect(big.downtimeSec!).toBeGreaterThan(small.downtimeSec! * 3);
  });
  it("silently failing backups turn a bad write into total data loss", () => {
    const r = run(doc(g), sc(1000, 400, [...bad(), { id: "s", kind: "backup-silent-fail", target: "db", atSec: 0 }]));
    expect(events(r).some((e) => e.kind === "no-backup")).toBe(true);
    expect(last(r).dataLoss!).toBeGreaterThan(30000); // everything written before the bad write is gone
  });
  it("replicas copy corruption: failover does not fix it", () => {
    const r = run(doc(g), sc(500, 150, bad()));
    expect(r.at(-1)!.nodes.db!.corrupt).toBe(1);
  });
});

describe("replicated-db: connections", () => {
  it("a pooler absorbs connection exhaustion", () => {
    const heavy = { maxConnections: 20, queryMs: 40 };
    const direct = run(doc(heavy), sc(2000, 20)).at(-1)!.global.errorRate;
    const pooled = run(doc({ ...heavy, poolMultiplex: 10 }), sc(2000, 20)).at(-1)!.global.errorRate;
    expect(direct).toBeGreaterThan(0.1);
    expect(pooled).toBeLessThan(direct / 2);
  });
});
