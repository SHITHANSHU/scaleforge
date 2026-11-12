// Authoring helper for the newer guided exercises (replicated-db, retries, gateway, app-service, idempotency, quorum).
// Run: pnpm tsx tools/challenge-lint/generate-new.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { createDefaultRegistry, type Challenge, type Scenario } from "../../packages/engine/index";

const reg = createDefaultRegistry();
type Cfg = Record<string, number | string | boolean>;
type N = [id: string, kind: string, x: number, y: number, cfg?: Cfg, label?: string];
type E = [from: string, fromPort: string, to: string, toPort: string];

function design(name: string, nodes: N[], edges: E[], scenario: Scenario) {
  const ns = nodes.map(([id, kind, x, y, cfg, label]) => ({ id, kind, x, y, label, config: { ...reg.get(kind)!.defaults, ...cfg } }));
  const es = edges.map(([from, fromPort, to, toPort], i) => {
    const a = reg.get(ns.find((n) => n.id === from)!.kind)!, b = reg.get(ns.find((n) => n.id === to)!.kind)!;
    const protocol = a.ports.find((p) => p.id === fromPort)!.protocols.find((p) => b.ports.find((q) => q.id === toPort)!.protocols.includes(p))!;
    return { id: `e${i + 1}`, from, fromPort, to, toPort, protocol, latencyMs: 1 };
  });
  return { schemaVersion: 1, id: `starter-${name}`, name, nodes: ns, edges: es, scenario, updatedAt: 0 };
}
const sc = (name: string, traffic: Scenario["traffic"], durationSec: number, extra: Partial<Scenario> = {}): Scenario => ({ name, durationSec, seed: 42, traffic, faults: [], ...extra });
const flat = (rps: number): Scenario["traffic"] => ({ type: "constant", rps });
const client = (cfg: Cfg = {}): N => ["c", "client", 0, 120, cfg];

interface Spec { meta: Omit<Challenge, "scenario">; scenario: Scenario; brief: string; starter: [N[], E[]]; solution: [N[], E[]]; writeup: string }

const specs: Spec[] = [
  {
    meta: { id: "replica-lag-01", title: "Reads that show old data", level: "mid", tags: ["replication", "stale reads", "read routing"], summary: "Users don't see their own updates after a write burst.", locked: ["c", "db.replicas", "db.applyQps"],
      criteria: [{ metric: "replicated-db.staleReadRate", op: "<", value: 0.05, after: 20, label: "Stale reads under 5%" }, { metric: "e2e.errorRate", op: "<", value: 0.01, after: 20, label: "Errors under 1%" }],
      hints: ["Which read-routing option never reads from a lagging copy?", "Routing every read to the primary is always fresh — what does it cost?", "Lag-aware routing falls back to the primary only when a replica is behind."] },
    scenario: sc("Write burst", flat(3000), 60),
    brief: "# Reads that show old data\n\nAn app reads from replicas to offload the primary. Replicas apply writes at 300/s but the primary takes about 600 writes/s, so lag grows and users miss their own updates.\n\nGet stale reads under 5% **without changing the replica count or apply rate**.\n\n**Concepts:** replication lag, read routing, freshness vs primary load.",
    starter: [[client({ readRatio: 0.8 }), ["db", "replicated-db", 300, 120, { replicas: 2, applyQps: 300, readRouting: "replicas", readQps: 6000, writeQps: 2000 }]], [["c", "out", "db", "in"]]],
    solution: [[client({ readRatio: 0.8 }), ["db", "replicated-db", 300, 120, { replicas: 2, applyQps: 300, readRouting: "lag-aware", maxStalenessSec: 1, readQps: 6000, writeQps: 2000 }]], [["c", "out", "db", "in"]]],
    writeup: "Lag-aware routing sends reads to replicas only while they are within the staleness bound, otherwise to the primary. Stale reads fall to near zero while most reads still avoid the primary. Trade-off: when lag is high the primary carries more reads.",
  },
  {
    meta: { id: "retry-amplification-01", title: "Retries that make it worse", level: "mid", tags: ["retries", "backoff", "jitter", "retry budget"], summary: "A 10-second blip becomes a long outage because clients retry in lockstep.", locked: ["app"],
      criteria: [{ metric: "e2e.retryRatio", op: "<", value: 1, label: "Retry traffic under 1× offered load" }, { metric: "e2e.availability", op: ">", value: 0.97, after: 60, label: "Healthy again by 60 s" }],
      hints: ["Fixed-delay retries arrive in synchronized waves.", "Backoff and jitter spread retries out; a retry budget caps them.", "Try the 'Backoff + jitter + 10% budget' preset on the traffic source."] },
    scenario: sc("Burst then recovery", { type: "spike", baseRps: 700, spikeRps: 1500, atSec: 10, widthSec: 10 }, 100, { timeoutMs: 500 }),
    brief: "# Retries that make it worse\n\nClients retry three times, 100 ms apart. A 10-second burst pushes the service over capacity and the retries keep it there.\n\nChange the **traffic source's retry policy** (you can't change the server) so the system recovers and retries stay under 1× the offered load.\n\n**Concepts:** retry amplification, backoff, jitter, retry budgets.",
    starter: [[client({ readRatio: 1, retries: 3, backoffMs: 100, backoffMultiplier: 1, jitter: 0, retryBudgetPct: 100 }), ["app", "ec2", 300, 120, { count: 2, vcpu: 5, burstable: false, cpuCostMs: 10, networkMbps: 25000, queueLimit: 20000, creditsPerHour: 0, initialCredits: 0 }]], [["c", "out", "app", "in"]]],
    solution: [[client({ readRatio: 1, retries: 3, backoffMs: 100, backoffMultiplier: 2, jitter: 1, retryBudgetPct: 10 }), ["app", "ec2", 300, 120, { count: 2, vcpu: 5, burstable: false, cpuCostMs: 10, networkMbps: 25000, queueLimit: 20000, creditsPerHour: 0, initialCredits: 0 }]], [["c", "out", "app", "in"]]],
    writeup: "Exponential backoff with jitter spreads retries over time and a retry budget bounds the extra load to a fraction of normal traffic. The server still has a deep queue of stale work, which a later exercise addresses with shedding.",
  },
  {
    meta: { id: "load-shedding-01", title: "Shed load before it queues", level: "senior", tags: ["load shedding", "queue age", "api gateway"], summary: "A deep backlog turns overload into universal timeouts.", locked: ["c", "app"],
      criteria: [{ metric: "e2e.p99", op: "<", value: 500, after: 30, label: "p99 under 500 ms" }, { metric: "e2e.availability", op: ">", value: 0.6, after: 30, label: "At least 60% of requests served" }],
      hints: ["Where would you put a component that can reject work early?", "Reject by how long a request would wait, not by queue size.", "An API gateway with 'shed load by queue age' enabled."] },
    scenario: sc("Sustained overload", flat(1600), 60),
    brief: "# Shed load before it queues\n\nDemand (1,600 req/s) is above capacity (1,000 req/s). Without protection the backlog grows and every request becomes slow.\n\nAdd a component so served requests stay fast (p99 under 500 ms) while at least 60% are served.\n\n**Concepts:** load shedding, queue age, goodput vs throughput.",
    starter: [[client({ readRatio: 1 }), ["app", "ec2", 400, 120, { count: 2, vcpu: 5, burstable: false, cpuCostMs: 10, networkMbps: 25000, queueLimit: 100000, creditsPerHour: 0, initialCredits: 0 }]], [["c", "out", "app", "in"]]],
    solution: [[client({ readRatio: 1 }), ["gw", "api-gateway", 220, 120, { capacityRps: 1000, shedding: true, maxQueueAgeMs: 100, breaker: false }], ["app", "ec2", 460, 120, { count: 2, vcpu: 5, burstable: false, cpuCostMs: 10, networkMbps: 25000, queueLimit: 100000, creditsPerHour: 0, initialCredits: 0 }]], [["c", "out", "gw", "in"], ["gw", "out", "app", "in"]]],
    writeup: "A gateway that rejects requests older than a bound keeps the queue short, so the requests it does serve are fast. Rejecting 37% of traffic is better than slowing everyone down. Trade-off: some callers see errors immediately and must handle them.",
  },
  {
    meta: { id: "bad-release-01", title: "Contain a bad release", level: "senior", tags: ["canary", "rollback", "blast radius"], summary: "A release returns errors but passes health checks.", locked: ["c"],
      criteria: [{ metric: "e2e.errorRate", op: "<", value: 0.08, label: "Peak error rate under 8% (blast radius)" }],
      hints: ["How much traffic sees the new version, and for how long?", "A canary limits exposure; something must notice the errors.", "Turn on automatic rollback."] },
    scenario: sc("Release at 60 s", flat(2000), 300, { faults: [{ id: "rel", kind: "release", target: "app", atSec: 60, params: { errPct: 30 } }] }),
    brief: "# Contain a bad release\n\nA release at 60 s makes 30% of requests fail. Health checks still pass. Change how the service releases so the peak error rate stays under 8%.\n\n**Concepts:** blast radius, canary releases, automatic rollback.",
    starter: [[client({ readRatio: 1 }), ["app", "app-service", 300, 120, { pods: 12, hpa: false, strategy: "rolling", autoRollback: false, cpuMsPerReq: 10, vcpuPerPod: 2, startupSec: 20 }]], [["c", "out", "app", "in"]]],
    solution: [[client({ readRatio: 1 }), ["app", "app-service", 300, 120, { pods: 12, hpa: false, strategy: "canary", canaryPct: 10, canaryHoldSec: 20, autoRollback: true, rollbackErrorPct: 5, detectSec: 10, cpuMsPerReq: 10, vcpuPerPod: 2, startupSec: 20 }]], [["c", "out", "app", "in"]]],
    writeup: "A canary exposes a small share while a rollback rule watches the error rate. Exposure is bounded by canary share × time to detect. Blue-green gives instant rollback but flips all traffic at once.",
  },
  {
    meta: { id: "duplicate-charge-01", title: "Stop the double charge", level: "senior", tags: ["idempotency", "dedup window", "at-least-once"], summary: "Timeouts and retries cause duplicate payments.", locked: ["c", "pay"],
      criteria: [{ metric: "e2e.duplicateRate", op: "<", value: 0.001, label: "Duplicates under 0.1%" }],
      hints: ["The client times out, retries, and the original may still complete.", "Remember recent request keys and answer repeats from memory.", "How long must a key be kept? Longer than the longest retry delay."] },
    scenario: sc("Slow payment provider", flat(300), 60, { timeoutMs: 600, faults: [{ id: "slow", kind: "edge-latency", target: "e1", atSec: 5, untilSec: 25, params: { addMs: 900 } }] }),
    brief: "# Stop the double charge\n\nThe payment provider slows down for 20 seconds. Clients time out after 600 ms and retry, but the first attempt may still complete — so customers are charged twice.\n\nKeep duplicates reaching the payment service under 0.1%.\n\n**Concepts:** idempotency keys, dedup window, at-least-once delivery.",
    starter: [[client({ readRatio: 0, retries: 2, backoffMs: 200, backoffMultiplier: 1, jitter: 0 }), ["pay", "ec2", 400, 120, { count: 4, vcpu: 4, burstable: false, cpuCostMs: 5, networkMbps: 25000, creditsPerHour: 0, initialCredits: 0 }]], [["c", "out", "pay", "in"]]],
    solution: [[client({ readRatio: 0, retries: 2, backoffMs: 200, backoffMultiplier: 1, jitter: 0 }), ["idem", "idempotency-store", 220, 120, { windowSec: 600, dupDelaySec: 30 }], ["pay", "ec2", 460, 120, { count: 4, vcpu: 4, burstable: false, cpuCostMs: 5, networkMbps: 25000, creditsPerHour: 0, initialCredits: 0 }]], [["c", "out", "idem", "in"], ["idem", "out", "pay", "in"]]],
    writeup: "An idempotency store in front of the payment service absorbs repeats within its retention window. The window must exceed the longest duplicate delay. This gives effectively-once execution at this boundary, not exactly-once delivery.",
  },
  {
    meta: { id: "quorum-availability-01", title: "Survive a node loss without going stale", level: "mid", tags: ["quorum", "consistency level", "availability"], summary: "Pick consistency levels that tolerate a node failure and stay consistent.", locked: ["c", "kv.nodes", "kv.rf"],
      criteria: [{ metric: "quorum-kv.availability", op: ">", value: 0.99, after: 10, label: "Operations succeed (>99%) with a node down" }, { metric: "quorum-kv.staleReadRate", op: "<", value: 0.01, after: 10, label: "No stale reads" }],
      hints: ["With RF=3, how many replicas does ALL need? Quorum?", "R + W > RF guarantees reads see the latest write.", "Quorum reads and writes tolerate one node down at RF=3."] },
    scenario: sc("One node fails", flat(2000), 30, { faults: [{ id: "f", kind: "fail-node", target: "kv", atSec: 5, params: { index: 0 } }] }),
    brief: "# Survive a node loss without going stale\n\nA replicated key-value store has RF=3 and currently reads/writes at ALL, so one dead node makes many operations fail. Reads/writes at ONE would stay available but can be stale.\n\nChoose consistency levels so operations stay available with a node down **and** reads are never stale.\n\n**Concepts:** quorums, R + W > RF, availability vs consistency.",
    starter: [[client({ readRatio: 0.7 }), ["kv", "quorum-kv", 300, 120, { nodes: 6, rf: 3, readCL: "all", writeCL: "all" }]], [["c", "out", "kv", "in"]]],
    solution: [[client({ readRatio: 0.7 }), ["kv", "quorum-kv", 300, 120, { nodes: 6, rf: 3, readCL: "quorum", writeCL: "quorum" }]], [["c", "out", "kv", "in"]]],
    writeup: "Quorum reads and writes overlap (2 + 2 > 3), so reads see the latest acknowledged write, and either survives one down replica. ALL tolerates none; ONE tolerates two but is eventually consistent. Latency also rises with the number of replicas you wait for.",
  },
];

for (const s of specs) {
  const dir = `challenges/guided/${s.meta.id}`;
  mkdirSync(dir, { recursive: true });
  const ch: Challenge = { ...s.meta, scenario: s.scenario };
  writeFileSync(`${dir}/challenge.json`, JSON.stringify(ch, null, 2));
  writeFileSync(`${dir}/brief.md`, s.brief + "\n");
  writeFileSync(`${dir}/writeup.md`, s.writeup + "\n");
  writeFileSync(`${dir}/starter.design.json`, JSON.stringify(design(s.meta.title, ...s.starter, s.scenario), null, 2));
  writeFileSync(`${dir}/solution.design.json`, JSON.stringify(design(s.meta.title + " (solution)", ...s.solution, s.scenario), null, 2));
}
console.log(`wrote ${specs.length} guided exercises`);
