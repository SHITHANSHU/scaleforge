import { describe, expect, it } from "vitest";
import { createDefaultRegistry, gradeOpen, lockViolationsOpen, Simulation, type Grading, type GraphDoc, type OpenChallenge, type Scenario } from "../index";

const reg = createDefaultRegistry();
const d = (kind: string, over = {}) => ({ ...reg.get(kind)!.defaults, ...over });
const sc = (rps: number, dur: number, faults: Scenario["faults"] = [], over: Partial<Scenario> = {}): Scenario => ({ name: "t", durationSec: dur, seed: 2, traffic: { type: "constant", rps }, faults, ...over });
const run = (g: GraphDoc, s: Scenario) => new Simulation(reg, g, s).run(1000);
const e = (id: string, from: string, fp: string, to: string, tp: string, protocol: string) => ({ id, from, fromPort: fp, to, toPort: tp, protocol });
const ev = (r: ReturnType<typeof run>) => r.flatMap((x) => x.events).map((x) => x.kind);

const challenge = (over: Partial<OpenChallenge["resources"]> = {}, scenario = sc(300, 20)): OpenChallenge => ({
  schemaVersion: 2, kind: "open", id: "x", title: "x", category: "c", level: "advanced", estimatedMinutes: 1, tags: [], summary: "",
  statement: { situation: "", symptoms: [], requirements: [], constraints: [] }, learningObjectives: [], references: [],
  resources: { fixed: [{ id: "users", kind: "client", x: 0, y: 0, locked: true, config: { share: 100 } }], ...over },
  scenarios: [{ id: "s", name: "s", description: "", scenario }], successCriteria: [],
});
const grading = (criteria: Grading["criteria"]): Grading => ({ schemaVersion: 2, passScore: 70, criteria });

describe("grading hardening", () => {
  it("a locked fixed node can't be changed in keys the author didn't list (retries, read ratio)", () => {
    const doc: GraphDoc = { nodes: [{ id: "users", kind: "client", config: d("client", { share: 100, retries: 8 }) }], edges: [] };
    expect(lockViolationsOpen(challenge(), doc, reg)).toContain("users.retries");
    expect(lockViolationsOpen(challenge(), { nodes: [{ id: "users", kind: "client", config: d("client", { share: 100 }) }], edges: [] }, reg)).toEqual([]);
  });
  it("a design that parks traffic forever (no consumers) is invalid, not 'healthy'", () => {
    const doc: GraphDoc = {
      nodes: [{ id: "users", kind: "client", config: d("client", { share: 100 }) }, { id: "k", kind: "kafka", config: d("kafka", { consumers: 0 }) }],
      edges: [e("e", "users", "out", "k", "produce", "tcp")],
    };
    const g = gradeOpen(reg, challenge({}, sc(2000, 30)), grading([{ id: "a", label: "avail", scenario: "all", metric: "e2e.availability", op: ">=", value: 0.99 }]), doc);
    expect(g.valid).toBe(false);
    expect(g.pass).toBe(false);
    expect(g.problems.join(" ")).toMatch(/served end to end/);
  });
  it("a criterion pointing at an unknown scenario is reported, not silently skipped", () => {
    const doc: GraphDoc = { nodes: [{ id: "users", kind: "client", config: d("client", { share: 100 }) }, { id: "a", kind: "ec2", config: d("ec2", { count: 10, vcpu: 4, burstable: false, cpuCostMs: 5, networkMbps: 25000 }) }], edges: [e("e", "users", "out", "a", "in", "http")] };
    const g = gradeOpen(reg, challenge(), grading([{ id: "a", label: "typo", hard: true, scenario: "nope", metric: "e2e.availability", op: ">=", value: 0.9 }]), doc);
    expect(g.problems.join(" ")).toMatch(/unknown scenario/);
    expect(g.pass).toBe(false);
  });
});

describe("retries are visible to the user", () => {
  it("backoff wait shows up in latency", () => {
    const g = (retries: number): GraphDoc => ({
      nodes: [{ id: "c", kind: "client", config: d("client", { readRatio: 1, retries, backoffMs: 2000, backoffMultiplier: 1, jitter: 0 }) }, { id: "app", kind: "ec2", config: d("ec2", { count: 2, vcpu: 4, burstable: false, cpuCostMs: 5, networkMbps: 25000 }) }],
      edges: [e("e", "c", "out", "app", "in", "http")],
    });
    const blip = [{ id: "k", kind: "kill-node", target: "app", atSec: 5, untilSec: 8 }];
    const p99 = (r: ReturnType<typeof run>) => Math.max(...r.map((x) => x.global.p99));
    expect(p99(run(g(2), sc(200, 30, blip)))).toBeGreaterThan(500); // was ~10 ms before retries carried their wait
  });
});

describe("app-service rollout state machine", () => {
  const svc = (cfg = {}): GraphDoc => ({
    nodes: [{ id: "c", kind: "client", config: d("client", { readRatio: 1 }) }, { id: "app", kind: "app-service", config: d("app-service", { pods: 8, hpa: false, vcpuPerPod: 1, cpuMsPerReq: 10, startupSec: 15, ...cfg }) }],
    edges: [e("e", "c", "out", "app", "in", "http")],
  });
  const rel = (errPct: number, at = 10) => [{ id: "r", kind: "release", target: "app", atSec: at, params: { errPct } }];
  it("a clean canary release completes, with no leaked pods and autoscaling re-enabled", () => {
    const r = run(svc({ strategy: "canary", canaryPct: 10, canaryHoldSec: 20, hpa: true }), sc(300, 200, rel(0)));
    expect(ev(r)).toContain("release-done");
    const last = r.at(-1)!.nodes.app!;
    expect(last.rolloutState).toBe(0);
    expect(last.pods).toBe(8);
    expect(last.newVersionShare).toBe(1);
  });
  it("a bad blue-green release keeps erroring until rolled back", () => {
    const r = run(svc({ strategy: "bluegreen", canaryHoldSec: 5, autoRollback: false }), sc(300, 120, rel(50)));
    expect(r.at(-1)!.global.errorRate).toBeGreaterThan(0.4);
  });
  it("an operator rollback after the rollout finished still works", () => {
    const faults = [...rel(50), { id: "rb", kind: "rollback", target: "app", atSec: 150 }];
    const r = run(svc({ strategy: "rolling", autoRollback: false }), sc(300, 260, faults));
    expect(r[145]!.global.errorRate).toBeGreaterThan(0.3);
    expect(ev(r)).toContain("rollback-done");
    expect(r.at(-1)!.global.errorRate).toBeLessThan(0.02);
  });
});

describe("other review fixes", () => {
  it("quorum-kv survivors take over a dead node's share and can overload", () => {
    const mk = (_down: boolean): GraphDoc => ({ nodes: [{ id: "c", kind: "client", config: d("client") }, { id: "kv", kind: "quorum-kv", config: d("quorum-kv", { nodes: 4, rf: 2, readCL: "one", writeCL: "one", nodeQps: 1200, compactionSlowdownPct: 0 }) }], edges: [e("e", "c", "out", "kv", "in", "tcp")] });
    const f = [{ id: "f", kind: "fail-node", target: "kv", atSec: 5, params: { index: 3 } }];
    const ok = run(mk(false), sc(2800, 20)).at(-1)!, hit = run(mk(true), sc(2800, 20, f)).at(-1)!;
    expect(hit.nodes.kv!.utilization!).toBeGreaterThan(ok.nodes.kv!.utilization!);
  });
  it("cross-region replication costs at least the round trip (no free zero-RPO)", () => {
    const mk = (lat: number): GraphDoc => ({ nodes: [{ id: "c", kind: "client", config: d("client", { readRatio: 0 }) }, { id: "db", kind: "replicated-db", config: d("replicated-db", { replication: "sync", syncCopies: 1, syncRttMs: lat, replicaPlacement: "other-region" }) }], edges: [e("e", "c", "out", "db", "in", "database")] });
    const p50 = run(mk(0.1), sc(500, 10, [], { regionRttMs: 80 })).at(-1)!.global.p50;
    expect(p50).toBeGreaterThan(70);
  });
  it("the breaker doesn't close without probe evidence", () => {
    const g: GraphDoc = {
      nodes: [{ id: "c", kind: "client", config: d("client", { readRatio: 1 }) }, { id: "gw", kind: "api-gateway", config: d("api-gateway", { openSec: 5, probePct: 5, minSamplesRps: 20, breaker: true }) }, { id: "app", kind: "ec2", config: d("ec2") }],
      edges: [e("e1", "c", "out", "gw", "in", "http"), e("e2", "gw", "out", "app", "in", "http")],
    };
    const r = run(g, sc(60, 80, [{ id: "k", kind: "kill-node", target: "app", atSec: 5 }]));
    expect(ev(r)).toContain("breaker-open");
    expect(r.at(-1)!.nodes.gw!.breakerState).not.toBe(0);
  });
});
