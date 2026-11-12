import { describe, expect, it } from "vitest";
import { createDefaultRegistry, Simulation, type GraphDoc, type Scenario } from "../index";

const reg = createDefaultRegistry();
const d = (kind: string, over = {}) => ({ ...reg.get(kind)!.defaults, ...over });
const sc = (rps: number, dur: number, faults: Scenario["faults"] = [], over: Partial<Scenario> = {}): Scenario => ({ name: "t", durationSec: dur, seed: 3, traffic: { type: "constant", rps }, faults, ...over });
const run = (g: GraphDoc, s: Scenario) => new Simulation(reg, g, s).run(1000);
const preset = (id: string) => reg.presetsFor("client").find((p) => p.id === id)!.values;

/** client → one app fleet with ~1000 rps capacity */
const chain = (clientCfg = {}): GraphDoc => ({
  nodes: [
    { id: "c", kind: "client", config: d("client", { readRatio: 1, ...clientCfg }) },
    { id: "app", kind: "ec2", config: d("ec2", { count: 2, vcpu: 5, burstable: false, cpuCostMs: 10, queueLimit: 100, networkMbps: 25000 }) },
  ],
  edges: [{ id: "e", from: "c", fromPort: "out", to: "app", toPort: "in", protocol: "http" }],
});
const outage = [{ id: "k", kind: "kill-node", target: "app", atSec: 10, untilSec: 20 }];

describe("client retries and failure feedback", () => {
  it("failures propagate back to the client and retries add load without inflating 'offered'", () => {
    const r = run(chain({ retries: 3, backoffMs: 50, backoffMultiplier: 1, jitter: 0 }), sc(500, 30, outage));
    const during = r[12]!.global;
    expect(during.offeredRps).toBeCloseTo(500, -1);
    expect(during.retryRps).toBeGreaterThan(300);
  });
  it("a retry that succeeds is not a user-visible error; exhausted retries are", () => {
    const flaky = sc(500, 30, [{ id: "k", kind: "kill-node", target: "app", atSec: 10, untilSec: 10.4 }]); // short blip
    const none = run(chain({ retries: 0 }), flaky);
    const withRetry = run(chain({ retries: 3, backoffMs: 200, backoffMultiplier: 2, jitter: 0 }), flaky);
    const tot = (r: ReturnType<typeof run>) => r.reduce((a, x) => a + x.global.droppedRps, 0);
    expect(tot(withRetry)).toBeLessThan(tot(none) / 2);
  });
  it("metastable failure: a short spike + deep queue + timeouts + naive retries never recovers; backoff/jitter/budget does", () => {
    // 1000 rps capacity, 700 rps normal, 10 s spike to 1500. A deep queue makes work stale; stale work times out and is retried.
    const g = (id: string): GraphDoc => { const x = chain(preset(id)); x.nodes[1]!.config = d("ec2", { count: 2, vcpu: 5, burstable: false, cpuCostMs: 10, queueLimit: 20000, networkMbps: 25000 }); return x; };
    const spike = sc(700, 120, [], { traffic: { type: "spike", baseRps: 700, spikeRps: 1500, atSec: 10, widthSec: 10 }, timeoutMs: 500 });
    const settleAfterSpike = (r: ReturnType<typeof run>) => { let last = -1; r.forEach((x, i) => { if (x.time > 20 && x.global.errorRate > 0.02) last = i; }); return last < 0 ? 0 : r[last]!.time - 20; };
    const none = settleAfterSpike(run(g("no-retry"), spike));
    const naive = settleAfterSpike(run(g("naive-retry"), spike));
    const polite = settleAfterSpike(run(g("polite-retry"), spike));
    expect(none).toBeLessThan(40);
    expect(naive).toBeGreaterThanOrEqual(95); // still failing at the end of the run
    expect(polite).toBeLessThan(naive / 2);
    const peak = (id: string) => Math.max(...run(g(id), spike).map((x) => x.global.retryRps));
    expect(peak("naive-retry")).toBeGreaterThan(peak("polite-retry") * 3);
  });
  it("a retry budget caps retry traffic", () => {
    const r = run(chain({ retries: 5, backoffMs: 50, backoffMultiplier: 1, jitter: 0, retryBudgetPct: 20 }), sc(500, 30, outage));
    expect(Math.max(...r.map((x) => x.global.retryRps))).toBeLessThanOrEqual(500 * 0.2 * 1.3);
  });
  it("client timeouts turn slow responses into failures; retried timeouts carry duplicate risk", () => {
    const slowEdge = [{ id: "l", kind: "edge-latency", target: "e", atSec: 5, untilSec: 20, params: { addMs: 800 } }];
    const noTimeout = run(chain({ retries: 2, backoffMs: 100 }), sc(300, 30, slowEdge));
    const timed = run(chain({ retries: 2, backoffMs: 100 }), sc(300, 30, slowEdge, { timeoutMs: 500 }));
    expect(noTimeout.at(10)!.global.errorRate).toBeLessThan(0.01);
    expect(timed.at(10)!.global.errorRate).toBeGreaterThan(0.2);
    expect(Math.max(...noTimeout.map((x) => x.global.duplicateRate))).toBe(0);
    expect(Math.max(...timed.map((x) => x.global.duplicateRate))).toBeGreaterThan(0); // the original may still have run
  });
  it("a region boundary kill takes down every node inside it", () => {
    const g = chain();
    g.nodes[1]!.parentId = "regionA";
    const r = run(g, sc(300, 20, [{ id: "k", kind: "kill-node", target: "regionA", atSec: 5 }]));
    expect(r.at(-1)!.down).toContain("app");
    expect(r.at(-1)!.global.throughputRps).toBe(0);
  });
});

describe("load balancer: regional failover and DNS", () => {
  /** client → LB → app in region A (priority) and app in region B (standby) */
  const g = (lb = {}): GraphDoc => ({
    nodes: [
      { id: "c", kind: "client", config: d("client", { readRatio: 1 }) },
      { id: "lb", kind: "load-balancer", config: d("load-balancer", { algorithm: "failover", checkIntervalSec: 2, unhealthyThreshold: 2, ...lb }) },
      { id: "a", kind: "ec2", parentId: "regionA", config: d("ec2", { count: 4, vcpu: 4, burstable: false, cpuCostMs: 5, networkMbps: 25000 }) },
      { id: "b", kind: "ec2", parentId: "regionB", config: d("ec2", { count: 4, vcpu: 4, burstable: false, cpuCostMs: 5, networkMbps: 25000 }) },
    ],
    edges: [
      { id: "e0", from: "c", fromPort: "out", to: "lb", toPort: "in", protocol: "http" },
      { id: "e1", from: "lb", fromPort: "out", to: "a", toPort: "in", protocol: "http" },
      { id: "e2", from: "lb", fromPort: "out", to: "b", toPort: "in", protocol: "http" },
    ],
  });
  const regionLoss = [{ id: "k", kind: "kill-node", target: "regionA", atSec: 10 }];
  const traffic = (r: ReturnType<typeof run>, edge: string, i: number) => r[i]!.edges[edge]!.rps;
  it("active-passive sends everything to the first healthy region, and fails over to the standby after detection", () => {
    const r = run(g(), sc(1000, 40, regionLoss));
    expect(traffic(r, "e1", 5)).toBeGreaterThan(900);
    expect(traffic(r, "e2", 5)).toBe(0);
    expect(r[11]!.global.errorRate).toBeGreaterThan(0.9); // undetected failure
    expect(traffic(r, "e2", 20)).toBeGreaterThan(900);
    expect(r.at(-1)!.global.errorRate).toBe(0);
  });
  it("DNS TTL and clients that ignore updates stretch the recovery", () => {
    const fast = run(g({ dnsTtlSec: 0 }), sc(1000, 120, regionLoss));
    const slow = run(g({ dnsTtlSec: 60 }), sc(1000, 120, regionLoss));
    const stuck = run(g({ dnsTtlSec: 0, staleClientPct: 15 }), sc(1000, 120, regionLoss));
    const errTotal = (r: ReturnType<typeof run>) => r.reduce((a, x) => a + x.global.droppedRps, 0);
    expect(errTotal(slow)).toBeGreaterThan(errTotal(fast) * 3);
    expect(stuck.at(-1)!.global.errorRate).toBeGreaterThan(0.1); // never fully recovers
    expect(fast.at(-1)!.global.errorRate).toBe(0);
  });
});

describe("event processing semantics", () => {
  const pipeline = (kafka = {}, sink = {}, idem = false): GraphDoc => ({
    nodes: [
      { id: "c", kind: "client", config: d("client", { readRatio: 0 }) },
      { id: "k", kind: "kafka", config: d("kafka", { partitions: 4, consumers: 4, consumerRate: 2000, partitionRate: 50000, ...kafka }) },
      ...(idem ? [{ id: "idem", kind: "idempotency-store", config: d("idempotency-store", { windowSec: 600, dupDelaySec: 30 }) }] : []),
      { id: "sink", kind: "ec2", config: d("ec2", { count: 4, vcpu: 4, burstable: false, cpuCostMs: 5, networkMbps: 25000, ...sink }) },
    ],
    edges: [
      { id: "e1", from: "c", fromPort: "out", to: "k", toPort: "produce", protocol: "tcp" },
      ...(idem
        ? [{ id: "e2", from: "k", fromPort: "consume", to: "idem", toPort: "in", protocol: "message-queue" }, { id: "e3", from: "idem", fromPort: "out", to: "sink", toPort: "in", protocol: "http" }]
        : [{ id: "e2", from: "k", fromPort: "consume", to: "sink", toPort: "in", protocol: "http" }]),
    ],
  });
  const rebalance = [{ id: "r", kind: "rebalance", target: "k", atSec: 10 }];
  const dup = (r: ReturnType<typeof run>) => Math.max(...r.map((x) => x.global.duplicateRate));
  it("a rebalance replays work since the last commit; an idempotent consumer absorbs it", () => {
    const plain = run(pipeline({ commitIntervalSec: 10 }), sc(3000, 40, rebalance));
    const guarded = run(pipeline({ commitIntervalSec: 10 }, {}, true), sc(3000, 40, rebalance));
    expect(dup(plain)).toBeGreaterThan(0.05);
    expect(plain.at(-1)!.nodes.k!.duplicates!).toBeGreaterThan(10000);
    expect(dup(guarded)).toBeLessThan(dup(plain) / 5);
  });
  it("a downstream slowdown is absorbed as lag when messages are re-queued, instead of dropping them", () => {
    const slowSink = { count: 1, vcpu: 1, cpuMsPerReq: 5, queueLimit: 20, cpuCostMs: 5 }; // ~200/s capacity vs 3000/s input
    const requeue = run(pipeline({ retryOnFailure: true }, slowSink), sc(3000, 30));
    const lose = run(pipeline({ retryOnFailure: false }, slowSink), sc(3000, 30));
    expect(requeue.at(-1)!.nodes.k!.requeued!).toBeGreaterThan(1000);
    expect(requeue.at(-1)!.nodes.k!.lagTotal!).toBeGreaterThan(lose.at(-1)!.nodes.k!.lagTotal!);
    const tot = (r: ReturnType<typeof run>) => r.reduce((a, x) => a + x.global.droppedRps, 0);
    expect(tot(requeue)).toBeLessThan(tot(lose));
  });
});

describe("regions and fault targeting", () => {
  it("a 'kind:' fault target hits every node of that kind, wherever the user placed it", () => {
    const g = chain();
    const r = run(g, sc(300, 20, [{ id: "k", kind: "kill-node", target: "kind:ec2", atSec: 5 }]));
    expect(r.at(-1)!.down).toContain("app");
  });
  it("cross-region edges pay the scenario's region RTT", () => {
    const g = chain();
    g.nodes[0]!.parentId = "A"; g.nodes[1]!.parentId = "B";
    const near = run(g, sc(100, 10)).at(-1)!.global.p50;
    const far = run(g, sc(100, 10, [], { regionRttMs: 90 })).at(-1)!.global.p50;
    expect(far - near).toBeGreaterThan(80);
  });
  it("a database with replicas in another region survives a regional outage; one in the same region does not", () => {
    const mk = (placement: string): GraphDoc => ({
      nodes: [
        { id: "c", kind: "client", config: d("client", { readRatio: 0.8 }) },
        { id: "db", kind: "replicated-db", parentId: "regionA", config: d("replicated-db", { replicas: 2, replicaPlacement: placement, detectSec: 5, promoteSec: 10, readQps: 4000, writeQps: 2000 }) },
      ],
      edges: [{ id: "e", from: "c", fromPort: "out", to: "db", toPort: "in", protocol: "database" }],
    });
    const outage = [{ id: "k", kind: "kill-node", target: "regionA", atSec: 10 }];
    const other = run(mk("other-region"), sc(1000, 60, outage));
    const same = run(mk("same-region"), sc(1000, 60, outage));
    expect(other.at(-1)!.global.errorRate).toBe(0);
    expect(other.at(-1)!.nodes.db!.writeAvailable).toBe(1);
    expect(same.at(-1)!.global.errorRate).toBeGreaterThan(0.9);
  });
  it("a quorum store spanning regions loses only one region's nodes", () => {
    const mk = (regions: number): GraphDoc => ({
      nodes: [{ id: "c", kind: "client", config: d("client") }, { id: "kv", kind: "quorum-kv", parentId: "regionA", config: d("quorum-kv", { nodes: 9, rf: 3, spreadRegions: regions }) }],
      edges: [{ id: "e", from: "c", fromPort: "out", to: "kv", toPort: "in", protocol: "database" }],
    });
    const outage = [{ id: "k", kind: "kill-node", target: "regionA", atSec: 10 }];
    expect(run(mk(1), sc(500, 30, outage)).at(-1)!.nodes.kv!.availability).toBe(0);
    expect(run(mk(3), sc(500, 30, outage)).at(-1)!.nodes.kv!.availability).toBe(1); // quorum 2 of 3 with one replica per region
  });
  it("verified backups survive a silent backup failure; unverified ones do not", () => {
    const mk = (verify: boolean): GraphDoc => ({
      nodes: [{ id: "c", kind: "client", config: d("client", { readRatio: 0.8 }) }, { id: "db", kind: "replicated-db", config: d("replicated-db", { snapshotIntervalSec: 60, backupVerification: verify, dataGB: 20 }) }],
      edges: [{ id: "e", from: "c", fromPort: "out", to: "db", toPort: "in", protocol: "database" }],
    });
    const faults = [{ id: "s", kind: "backup-silent-fail", target: "db", atSec: 0 }, { id: "b", kind: "bad-write", target: "db", atSec: 200, params: { detectSec: 30 } }];
    const loss = (v: boolean) => run(mk(v), sc(500, 600, faults)).at(-1)!.nodes.db!.dataLoss!;
    expect(loss(false)).toBeGreaterThan(loss(true) * 2);
  });
});

describe("dead ends are errors, not successes", () => {
  it("traffic that goes nowhere counts as failed (a design can't pass by connecting nothing)", () => {
    const g: GraphDoc = { nodes: [{ id: "c", kind: "client", config: d("client") }, { id: "app", kind: "ec2", config: d("ec2") }], edges: [] };
    const r = run(g, sc(500, 10));
    expect(r.at(-1)!.global.throughputRps).toBe(0);
    expect(r.at(-1)!.global.errorRate).toBe(1);
  });
  it("a balancer with no backends drops; a leaf service still completes", () => {
    const lb: GraphDoc = { nodes: [{ id: "c", kind: "client", config: d("client") }, { id: "lb", kind: "load-balancer", config: d("load-balancer") }], edges: [{ id: "e", from: "c", fromPort: "out", to: "lb", toPort: "in", protocol: "http" }] };
    expect(run(lb, sc(300, 10)).at(-1)!.global.errorRate).toBe(1);
    expect(run(chain(), sc(300, 10)).at(-1)!.global.errorRate).toBe(0);
  });
});
