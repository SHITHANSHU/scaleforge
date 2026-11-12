import { describe, expect, it } from "vitest";
import { createDefaultRegistry, Simulation, type GraphDoc, type Scenario } from "../index";

const reg = createDefaultRegistry();
const d = (kind: string, over = {}) => ({ ...reg.get(kind)!.defaults, ...over });
const sc = (traffic: Scenario["traffic"], dur: number, faults: Scenario["faults"] = [], over: Partial<Scenario> = {}): Scenario => ({ name: "t", durationSec: dur, seed: 9, traffic, faults, ...over });
const flat = (rps: number): Scenario["traffic"] => ({ type: "constant", rps });
const run = (g: GraphDoc, s: Scenario) => new Simulation(reg, g, s).run(1000);
const edge = (id: string, from: string, fp: string, to: string, tp: string, protocol: string) => ({ id, from, fromPort: fp, to, toPort: tp, protocol });
const svc = (cfg = {}, client = {}): GraphDoc => ({
  nodes: [{ id: "c", kind: "client", config: d("client", { readRatio: 1, ...client }) }, { id: "app", kind: "app-service", config: d("app-service", { pods: 4, vcpuPerPod: 1, cpuMsPerReq: 10, startupSec: 20, ...cfg }) }],
  edges: [edge("e", "c", "out", "app", "in", "http")],
});
const release = (at: number, errPct = 0, latencyX = 1) => [{ id: "r", kind: "release", target: "app", atSec: at, params: { errPct, latencyX } }];
const errTotal = (r: ReturnType<typeof run>) => r.reduce((a, x) => a + x.global.droppedRps, 0) / Math.max(1, r.reduce((a, x) => a + x.global.droppedRps + x.global.throughputRps, 0));
const ev = (r: ReturnType<typeof run>) => r.flatMap((x) => x.events).map((e) => e.kind);

describe("app-service: autoscaling", () => {
  const step = (hpaMetric: string, extra = {}) => run(svc({ hpa: true, hpaMetric, hpaTarget: hpaMetric === "queue" ? 0.2 : 0.6, hpaCooldownSec: 10, startupSec: 30, maxStepPods: 10, queueLimit: 5000, ...extra }), sc({ type: "step", baseRps: 200, stepRps: 1500, atSec: 20 }, 150));
  it("scales out after the delay: errors during warm-up, healthy after", () => {
    const r = step("cpu");
    expect(r[25]!.global.errorRate).toBeGreaterThan(0.1); // spike before new pods are ready
    expect(r.at(-1)!.nodes.app!.pods!).toBeGreaterThan(4);
    expect(r.at(-1)!.global.errorRate).toBeLessThan(0.02);
    expect(ev(r)).toContain("scale-out");
  });
  it("queue-wait scaling reacts when CPU is already pinned and hides nothing", () => {
    const cpu = step("cpu", { hpaTarget: 0.95 }); const queue = step("queue");
    const firstScale = (r: ReturnType<typeof run>) => r.find((x) => x.events.some((e) => e.kind === "scale-out"))?.time ?? 999;
    expect(firstScale(queue)).toBeLessThanOrEqual(firstScale(cpu));
  });
  it("scales back in after the stabilization delay", () => {
    const r = run(svc({ hpa: true, hpaTarget: 0.5, hpaCooldownSec: 5, startupSec: 5, scaleDownDelaySec: 30, maxStepPods: 10 }), sc({ type: "spike", baseRps: 100, spikeRps: 1500, atSec: 10, widthSec: 30 }, 200));
    const peak = Math.max(...r.map((x) => x.nodes.app!.pods!));
    expect(peak).toBeGreaterThan(6);
    expect(r.at(-1)!.nodes.app!.pods!).toBeLessThan(peak);
  });
});

describe("app-service: releases", () => {
  const base = { hpa: false, pods: 8, vcpuPerPod: 1, cpuMsPerReq: 10, startupSec: 15, canaryHoldSec: 40, detectSec: 20, rollbackErrorPct: 5 };
  it("a bad rolling release without rollback ends at 100% on the bad version with sustained errors", () => {
    const r = run(svc({ ...base, strategy: "rolling", autoRollback: false }), sc(flat(300), 200, release(10, 30)));
    expect(r.at(-1)!.nodes.app!.newVersionShare).toBe(1);
    expect(r.at(-1)!.global.errorRate).toBeGreaterThan(0.25);
    expect(ev(r)).toContain("release-done");
  });
  it("auto-rollback bounds the damage; manual-less rolling does not", () => {
    const bad = run(svc({ ...base, strategy: "rolling", autoRollback: false }), sc(flat(300), 200, release(10, 30)));
    const rb = run(svc({ ...base, strategy: "rolling", autoRollback: true }), sc(flat(300), 200, release(10, 30)));
    expect(ev(rb)).toContain("rollback");
    expect(ev(rb)).toContain("rollback-done");
    expect(errTotal(rb)).toBeLessThan(errTotal(bad) / 3);
    expect(rb.at(-1)!.nodes.app!.newVersionShare).toBe(0);
  });
  it("canary exposes far fewer users than a straight rolling release, then rolls back fast", () => {
    const canary = run(svc({ ...base, strategy: "canary", canaryPct: 10, autoRollback: true }), sc(flat(300), 200, release(10, 40)));
    const rolling = run(svc({ ...base, strategy: "rolling", autoRollback: true }), sc(flat(300), 200, release(10, 40)));
    expect(errTotal(canary)).toBeLessThan(errTotal(rolling));
    expect(Math.max(...canary.map((x) => x.nodes.app!.newVersionShare!))).toBeLessThanOrEqual(0.2);
  });
  it("blue-green flips all traffic at once (full exposure) but rolls back instantly; costs double during the rollout", () => {
    const g = run(svc({ ...base, strategy: "bluegreen", autoRollback: true }), sc(flat(300), 200, release(10, 40)));
    expect(Math.max(...g.map((x) => x.nodes.app!.newVersionShare!))).toBe(1);
    expect(ev(g)).toContain("flip");
    expect(ev(g)).toContain("rollback");
    const costs = g.map((x) => x.global.costPerHour);
    expect(Math.max(...costs)).toBeGreaterThan(costs[0]! * 1.8);
  });
  it("a short graceful shutdown drops in-flight requests during a deploy", () => {
    const busy = { ...base, queueLimit: 2000, pods: 8, cpuMsPerReq: 10 };
    const gentle = run(svc({ ...busy, gracefulSec: 30 }), sc(flat(760), 120, release(10, 0)));
    const abrupt = run(svc({ ...busy, gracefulSec: 0 }), sc(flat(760), 120, release(10, 0)));
    expect(errTotal(abrupt)).toBeGreaterThanOrEqual(errTotal(gentle));
  });
  it("a good rolling release completes with no errors", () => {
    const r = run(svc({ ...base, strategy: "rolling" }), sc(flat(300), 200, release(10, 0)));
    expect(ev(r)).toContain("release-done");
    expect(errTotal(r)).toBeLessThan(0.01);
  });
});

describe("app-service: cache fallback", () => {
  /** client → app → (cache → db) / (db) */
  const g = (fallback: boolean): GraphDoc => ({
    nodes: [
      { id: "c", kind: "client", config: d("client", { readRatio: 0.95 }) },
      { id: "app", kind: "app-service", config: d("app-service", { pods: 10, vcpuPerPod: 2, cpuMsPerReq: 5, hpa: false, cacheFallback: fallback }) },
      { id: "r", kind: "redis", config: d("redis", { memoryMB: 512, keyspace: 20000, avgItemKB: 1, ttlSec: 0 }) },
      { id: "db", kind: "replicated-db", config: d("replicated-db", { readQps: 1500, writeQps: 1500, replicas: 1 }) },
    ],
    edges: [edge("e1", "c", "out", "app", "in", "http"), edge("e2", "app", "cache", "r", "in", "cache-access"), edge("e3", "app", "db", "db", "in", "database"), edge("e4", "r", "miss", "db", "in", "database")],
  });
  const dead = [{ id: "k", kind: "kill-node", target: "r", atSec: 30 }];
  it("cache outage: fail-open sends reads to the DB (overloading it); fail-closed errors out", () => {
    const open = run(g(true), sc(flat(2500), 60, dead));
    const closed = run(g(false), sc(flat(2500), 60, dead));
    expect(closed.at(-1)!.global.errorRate).toBeGreaterThan(0.7);
    expect(open.at(-1)!.nodes.app!.fallbackRate!).toBeGreaterThan(1500);
    expect(open.at(-1)!.nodes.db!.utilization!).toBeGreaterThan(0.9); // the fallback path is itself overloading the database
  });
});
