import { rovingKeys } from "../lib/roving";
import { useMemo, useState } from "react";
import { BloomFilter, bloomFpRate, bloomParams, createDefaultRegistry, createRng, fnv1a, HashRing, LFUCache, LRUCache, remapFraction, rendezvous, Simulation, type GraphDoc, type Scenario } from "@scaleforge/engine";
import { Chart } from "../panels/Chart";
import { FieldRow } from "../panels/fields";
import { fmt } from "../lib/format";

const num = (key: string, label: string, min: number, max: number, step: number, unit?: string, scale?: "log", help?: string) => ({ key, label, type: "number" as const, min, max, step, unit, scale, help });

type Lab = "bloom" | "eviction" | "kafka" | "routing" | "retry" | "hashing" | "replication" | "quorum";
const labs: { id: Lab; title: string; blurb: string }[] = [
  { id: "bloom", title: "Bloom filter", blurb: "Size n and p, overfill it, watch the real false-positive rate." },
  { id: "eviction", title: "Eviction policies", blurb: "LRU vs LFU vs random on the same skewed key stream." },
  { id: "kafka", title: "Kafka partitions & consumers", blurb: "Why extra consumers sit idle and hot keys hurt." },
  { id: "routing", title: "RabbitMQ routing", blurb: "Direct, topic, fanout and headers exchanges, with real matching." },
  { id: "retry", title: "Retries & metastable failure", blurb: "Why a 10-second blip can become a 10-minute outage." },
  { id: "hashing", title: "Hashing strategies", blurb: "Modulo vs consistent vs rendezvous when nodes come and go." },
  { id: "replication", title: "Replication & failover", blurb: "Lag, promotion time, data loss and split brain." },
  { id: "quorum", title: "Quorums & consistency", blurb: "R + W vs RF, availability and stale reads with nodes down." },
];

export function Labs() {
  const [lab, setLab] = useState<Lab>("bloom");
  return (
    <div className="flex h-full">
      <nav className="w-60 shrink-0 border-r border-line bg-surface p-2" aria-label="Labs">
        {labs.map((l) => (
          <button key={l.id} onClick={() => setLab(l.id)} aria-current={lab === l.id} className={`mb-0.5 w-full rounded-md px-2.5 py-2 text-left ${lab === l.id ? "bg-hover" : "hover:bg-hover"}`}>
            <div className="text-[12.5px] font-medium">{l.title}</div><div className="text-[11px] leading-snug text-faint">{l.blurb}</div>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-2xl px-6 py-8">
        {lab === "bloom" && <BloomLab />}{lab === "eviction" && <EvictionLab />}{lab === "kafka" && <KafkaLab />}{lab === "routing" && <RoutingLab />}{lab === "retry" && <RetryLab />}{lab === "hashing" && <HashingLab />}{lab === "replication" && <ReplicationLab />}{lab === "quorum" && <QuorumLab />}
      </div></div>
    </div>
  );
}

const Title = ({ t, d }: { t: string; d: string }) => <header className="mb-4"><h1 className="text-[18px] font-semibold">{t}</h1><p className="mt-1 text-muted">{d}</p></header>;
const Stat = ({ l, v, tone }: { l: string; v: string; tone?: "bad" | "ok" }) => <div className="rounded-md bg-surface px-3 py-2"><div className="text-[10.5px] uppercase tracking-wider text-faint">{l}</div><div className={`mono text-[16px] ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}>{v}</div></div>;

function BloomLab() {
  const [n, setN] = useState(100000), [p, setP] = useState(0.01), [ins, setIns] = useState(100000);
  const r = useMemo(() => {
    const { m, k } = bloomParams(n, p);
    const scale = Math.max(1, m / (1 << 22));
    const f = new BloomFilter(Math.ceil(m / scale), k);
    const items = Math.min(Math.floor(ins / scale), 3_000_000);
    for (let i = 0; i < items; i++) f.add(i);
    let fp = 0; const T = 20000; for (let i = 0; i < T; i++) if (f.has(1e9 + i)) fp++;
    return { m, k, observed: fp / T, theory: bloomFpRate(f.m, f.k, f.count) };
  }, [n, p, ins]);
  return (
    <>
      <Title t="Bloom filter lab" d="A real Bloom filter runs on 20,000 absent keys. Push the inserted count past n and watch false positives climb." />
      <FieldRow field={num("n", "Expected items (n)", 1000, 5_000_000, 1000, undefined, "log")} value={n} onChange={(v) => setN(Number(v))} />
      <FieldRow field={num("p", "Target false-positive rate (p)", 0.0001, 0.2, 0.0001, undefined, "log")} value={p} onChange={(v) => setP(Number(v))} />
      <FieldRow field={num("i", "Items inserted", 0, 10_000_000, 1000)} value={ins} onChange={(v) => setIns(Number(v))} />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat l="bits (m)" v={fmt(r.m)} /><Stat l="hashes (k)" v={String(r.k)} />
        <Stat l="FP theory" v={`${(r.theory * 100).toFixed(2)}%`} /><Stat l="FP observed" v={`${(r.observed * 100).toFixed(2)}%`} tone={r.observed > p * 2 ? "bad" : "ok"} />
      </div>
      <p className="mt-3 text-[12px] text-faint">Memory: {(r.m / 8 / 1024).toFixed(0)} KB. Scale-down note: filters above 4M bits are simulated at proportional scale; ratios are preserved.</p>
    </>
  );
}

function EvictionLab() {
  const [cap, setCap] = useState(1000), [keys, setKeys] = useState(20000), [skew, setSkew] = useState(1.0);
  const res = useMemo(() => {
    const rng = createRng(7);
    const w: number[] = []; let tot = 0;
    for (let i = 1; i <= keys; i++) { tot += Math.pow(i, -skew); w.push(tot); }
    const draw = () => { const x = rng.next() * tot; let lo = 0, hi = keys - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (w[m]! < x) lo = m + 1; else hi = m; } return lo; };
    const stream = Array.from({ length: 60000 }, draw);
    const run = (c: { get(k: number): unknown; set(k: number, v: true): void }) => { let h = 0; for (const k of stream) { if (c.get(k) !== undefined) h++; else c.set(k, true); } return h / stream.length; };
    const rand = (() => { const s = new Set<number>(); const arr: number[] = []; const r2 = createRng(9); return { get: (k: number) => (s.has(k) ? true : undefined), set: (k: number) => { if (s.size >= cap) { const i = Math.floor(r2.next() * arr.length); s.delete(arr[i]!); arr[i] = k; } else arr.push(k); s.add(k); } }; })();
    return [["LRU", run(new LRUCache<number>(cap))], ["LFU", run(new LFUCache<number>(cap))], ["Random", run(rand)]] as [string, number][];
  }, [cap, keys, skew]);
  return (
    <>
      <Title t="Eviction policy lab" d="60,000 requests from one Zipf key stream, replayed against each policy. Real LRU and LFU implementations." />
      <FieldRow field={num("c", "Cache capacity (items)", 10, 20000, 10, undefined, "log")} value={cap} onChange={(v) => setCap(Number(v))} />
      <FieldRow field={num("k", "Distinct keys", 1000, 200000, 1000, undefined, "log")} value={keys} onChange={(v) => setKeys(Number(v))} />
      <FieldRow field={num("s", "Key skew (Zipf s)", 0, 2, 0.05, undefined, undefined, "0 = uniform: no policy helps. High skew: frequency wins.")} value={skew} onChange={(v) => setSkew(Number(v))} />
      <ul className="mt-4 space-y-2" aria-label="Hit ratios">
        {res.map(([n, h]) => <li key={n} className="flex items-center gap-3"><span className="w-14 text-[12px]">{n}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent" style={{ width: `${h * 100}%` }} /></div><span className="mono w-14 text-right text-[12px]">{(h * 100).toFixed(1)}%</span></li>)}
      </ul>
    </>
  );
}

const reg = createDefaultRegistry();
function KafkaLab() {
  const [parts, setParts] = useState(6), [cons, setCons] = useState(8), [hot, setHot] = useState(0), [input, setInput] = useState(30000), [rate, setRate] = useState(8000);
  const out = useMemo(() => {
    const doc: GraphDoc = { nodes: [{ id: "c", kind: "client", config: { ...reg.get("client")!.defaults, readRatio: 0 } }, { id: "k", kind: "kafka", config: { ...reg.get("kafka")!.defaults, partitions: parts, consumers: cons, consumerRate: rate, hotKeyShare: hot, partitionRate: 20000 } }], edges: [{ id: "e", from: "c", fromPort: "out", to: "k", toPort: "produce", protocol: "tcp" }] };
    const sim = new Simulation(reg, doc, { name: "lab", durationSec: 20, seed: 1, traffic: { type: "constant", rps: input }, faults: [] });
    const s = sim.run(1000).at(-1)!;
    return { lag: s.nodes.k!.lagTotal!, max: s.nodes.k!.lagMax!, idle: s.nodes.k!.idleConsumers!, err: s.global.errorRate };
  }, [parts, cons, hot, input, rate]);
  return (
    <>
      <Title t="Kafka partition & consumer lab" d="A 20-second run of the real engine. Lag = (input − capacity) × time." />
      <FieldRow field={num("p", "Partitions", 1, 64, 1)} value={parts} onChange={(v) => setParts(Number(v))} />
      <FieldRow field={num("c", "Consumers", 0, 64, 1)} value={cons} onChange={(v) => setCons(Number(v))} />
      <FieldRow field={num("r", "Rate per consumer", 500, 50000, 100, "msg/s", "log")} value={rate} onChange={(v) => setRate(Number(v))} />
      <FieldRow field={num("i", "Input", 1000, 200000, 1000, "msg/s", "log")} value={input} onChange={(v) => setInput(Number(v))} />
      <FieldRow field={num("h", "Hot-key share", 0, 1, 0.01)} value={hot} onChange={(v) => setHot(Number(v))} />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat l="total lag" v={fmt(out.lag)} tone={out.lag > 20000 ? "bad" : "ok"} /><Stat l="max partition lag" v={fmt(out.max)} /><Stat l="idle consumers" v={String(out.idle)} tone={out.idle ? "bad" : "ok"} /><Stat l="rejected" v={`${(out.err * 100).toFixed(1)}%`} />
      </div>
      <p className="mt-3 text-[12px] text-faint">Group ceiling: {fmt(Math.min(cons, parts) * rate)} msg/s ({Math.min(cons, parts)} active consumers).</p>
    </>
  );
}

/** AMQP topic matching: words split on ".", "*" = one word, "#" = zero or more. */
export function topicMatch(pattern: string, key: string): boolean {
  const p = pattern.split("."), k = key.split(".");
  const go = (i: number, j: number): boolean => {
    if (i === p.length) return j === k.length;
    if (p[i] === "#") return go(i + 1, j) || (j < k.length && go(i, j + 1));
    return j < k.length && (p[i] === "*" || p[i] === k[j]) && go(i + 1, j + 1);
  };
  return go(0, 0);
}
const bindings = [["orders.created", "billing"], ["orders.*", "audit"], ["#", "archive"], ["payments.#", "ledger"]] as const;
function RoutingLab() {
  const [ex, setEx] = useState<"direct" | "topic" | "fanout" | "headers">("topic"), [key, setKey] = useState("orders.created"), [hdr, setHdr] = useState("region=eu");
  const hit = bindings.filter(([b]) => ex === "fanout" ? true : ex === "direct" ? b === key : ex === "topic" ? topicMatch(b, key) : b.includes(hdr.split("=")[0]!.slice(0, 3)) || b === "#").map(([, q]) => q);
  return (
    <>
      <Title t="RabbitMQ routing lab" d="Publish one message and see which queues receive it. Bindings are fixed; change the exchange type and routing key." />
      <div role="radiogroup" aria-label="Exchange type" onKeyDown={rovingKeys} className="flex w-fit rounded-md border border-line bg-bg p-0.5">
        {(["direct", "topic", "fanout", "headers"] as const).map((e) => <button key={e} role="radio" tabIndex={ex === e ? 0 : -1} aria-checked={ex === e} onClick={() => setEx(e)} className={`rounded px-3 py-1 text-[12px] capitalize ${ex === e ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{e}</button>)}
      </div>
      <label className="mt-4 block text-[12px]">{ex === "headers" ? "Header" : "Routing key"}
        <input value={ex === "headers" ? hdr : key} onChange={(e) => (ex === "headers" ? setHdr(e.target.value) : setKey(e.target.value))} className="mono mt-1 block w-72 rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent" /></label>
      <table className="mt-5 w-full text-[12.5px]"><thead className="text-left text-[10.5px] uppercase tracking-wider text-faint"><tr><th className="pb-1">Binding</th><th className="pb-1">Queue</th><th className="pb-1">Receives?</th></tr></thead>
        <tbody>{bindings.map(([b, q]) => <tr key={q} className="border-t border-line"><td className="mono py-1.5">{ex === "fanout" ? "(ignored)" : b}</td><td>{q}</td><td className={hit.includes(q) ? "text-ok" : "text-faint"}>{hit.includes(q) ? "● yes" : "—"}</td></tr>)}</tbody></table>
      <p className="mt-3 text-[12px] text-faint">{ex === "fanout" ? "Fanout copies the message to every bound queue — work multiplies with queue count." : ex === "topic" ? "* matches exactly one word, # matches zero or more." : ex === "direct" ? "Direct requires an exact key match." : "Headers exchange matching is simplified in this lab."}</p>
    </>
  );
}

const Seg = ({ label, value, set, options }: { label: string; value: string; set(v: any): void; options: [string, string][] }) => (
  <div className="mt-3"><div className="mb-1 text-[12px]">{label}</div>
    <div role="radiogroup" aria-label={label} className="flex w-fit flex-wrap rounded-md border border-line bg-bg p-0.5" onKeyDown={rovingKeys}>
      {options.map(([v, l]) => <button key={v} role="radio" tabIndex={v === value ? 0 : -1} aria-checked={v === value} onClick={() => set(v)} className={`rounded px-3 py-1 text-[12px] ${v === value ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{l}</button>)}
    </div></div>
);
const doc2 = (nodes: GraphDoc["nodes"], edges: GraphDoc["edges"]): GraphDoc => ({ nodes, edges });
const nd = (id: string, kind: string, over: Record<string, number | string | boolean> = {}) => ({ id, kind, config: { ...reg.get(kind)!.defaults, ...over } });
const ed = (id: string, from: string, fromPort: string, to: string, toPort: string, protocol: string) => ({ id, from, fromPort, to, toPort, protocol });
const sc2 = (traffic: Scenario["traffic"], durationSec: number, faults: Scenario["faults"] = [], extra: Partial<Scenario> = {}): Scenario => ({ name: "lab", durationSec, seed: 3, traffic, faults, ...extra });

function RetryLab() {
  const [policy, setPolicy] = useState<"none" | "naive-retry" | "polite-retry">("naive-retry");
  const [queue, setQueue] = useState(20000);
  const r = useMemo(() => {
    const p = reg.presetsFor("client").find((x) => x.id === (policy === "none" ? "no-retry" : policy))!.values;
    const g = doc2([nd("c", "client", { readRatio: 1, ...p }), nd("app", "ec2", { count: 2, vcpu: 5, burstable: false, cpuCostMs: 10, queueLimit: queue, networkMbps: 25000 })], [ed("e", "c", "out", "app", "in", "http")]);
    const snaps = new Simulation(reg, g, sc2({ type: "spike", baseRps: 700, spikeRps: 1500, atSec: 10, widthSec: 10 }, 90, [], { timeoutMs: 500 })).run(1000);
    return snaps;
  }, [policy, queue]);
  const xs = r.map((s) => s.time);
  let last = -1; r.forEach((s, i) => { if (s.time > 20 && s.global.errorRate > 0.02) last = i; });
  const settle = last < 0 ? 0 : last === r.length - 1 ? Infinity : r[last + 1]!.time - 20;
  return (
    <>
      <Title t="Retries & metastable failure" d="Capacity 1,000 req/s, normal load 700, a 10 s burst to 1,500 starting at 10 s. Clients time out after 500 ms. Does the system recover when the burst ends?" />
      <Seg label="Client retry policy" value={policy} set={setPolicy} options={[["none", "No retries"], ["naive-retry", "3 retries, fixed 100 ms"], ["polite-retry", "Backoff + jitter + 10% budget"]]} />
      <FieldRow field={num("q", "Server backlog size", 100, 50000, 100, "req", "log", "A deep backlog holds stale work that clients have already given up on.")} value={queue} onChange={(v) => setQueue(Number(v))} />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"><Stat l="recovers after burst" v={Number.isFinite(settle) ? `${settle.toFixed(0)} s` : "never (in 90 s)"} tone={Number.isFinite(settle) && settle < 30 ? "ok" : "bad"} /><Stat l="peak retry load" v={`${fmt(Math.max(...r.map((s) => s.global.retryRps)))}/s`} /><Stat l="peak error rate" v={`${(Math.max(...r.map((s) => s.global.errorRate)) * 100).toFixed(0)}%`} /></div>
      <div className="mt-4 space-y-3">
        <Chart title="Success rate" percent xs={xs} lines={[{ label: "success", color: "#4ade80", values: r.map((s) => 1 - s.global.errorRate) }]} height={90} />
        <Chart title="Load on the service" unit="req/s" xs={xs} lines={[{ label: "offered", color: "#94a3b8", values: r.map((s) => s.global.offeredRps), dash: [4, 3] }, { label: "retries", color: "#f87171", values: r.map((s) => s.global.retryRps) }]} height={90} />
      </div>
    </>
  );
}

function HashingLab() {
  const [n, setN] = useState(8);
  const res = useMemo(() => {
    const names = (k: number) => Array.from({ length: k }, (_, i) => `node${i}`);
    const before = names(n), added = names(n + 1), removed = names(n - 1);
    const modulo = (k: number, ns: string[]) => ns[fnv1a(k) % ns.length]!;
    const ring = (k: number, ns: string[]) => new HashRing(ns, 100).lookup(k);
    const spread = (assign: (k: number, ns: string[]) => string) => { const c: Record<string, number> = {}; for (let i = 0; i < 20000; i++) { const o = assign(i, before); c[o] = (c[o] ?? 0) + 1; } const v = Object.values(c); return Math.max(...v) / (20000 / n); };
    const strategies: [string, (k: number, ns: string[]) => string][] = [["Modulo (hash % N)", modulo], ["Consistent hash ring (100 vnodes)", ring], ["Rendezvous (highest random weight)", rendezvous]];
    return strategies.map(([name, f]) => ({ name, add: remapFraction(f, before, added), remove: n > 2 ? remapFraction(f, before, removed) : 0, imbalance: spread(f) }));
  }, [n]);
  return (
    <>
      <Title t="Hashing strategies" d="What fraction of keys must move when a node is added or removed? Moving keys means cold caches and rebalancing traffic. The ideal is 1/N." />
      <FieldRow field={num("n", "Nodes", 3, 40, 1)} value={n} onChange={(v) => setN(Number(v))} />
      <table className="mt-4 w-full text-[12.5px]"><thead className="text-left text-[10.5px] uppercase tracking-wider text-faint"><tr><th className="pb-1">Strategy</th><th>Add a node</th><th>Remove a node</th><th>Busiest node vs ideal</th></tr></thead>
        <tbody>{res.map((r) => <tr key={r.name} className="border-t border-line"><td className="py-1.5">{r.name}</td><td className={`mono ${r.add > 0.5 ? "text-bad" : "text-ok"}`}>{(r.add * 100).toFixed(0)}% moved</td><td className={`mono ${r.remove > 0.5 ? "text-bad" : "text-ok"}`}>{(r.remove * 100).toFixed(0)}% moved</td><td className="mono">{r.imbalance.toFixed(2)}×</td></tr>)}</tbody></table>
      <p className="mt-3 text-[12px] text-faint">Ideal move fraction: add ≈ {(100 / (n + 1)).toFixed(0)}%, remove ≈ {(100 / n).toFixed(0)}%. Real implementations differ in how they weight nodes, handle replicas and bound load; this lab shows only the remapping and spread of the plain algorithms.</p>
    </>
  );
}

function ReplicationLab() {
  const [mode, setMode] = useState<"async" | "sync">("async"), [replicas, setReplicas] = useState(2), [detect, setDetect] = useState(10), [promote, setPromote] = useState(15), [fence, setFence] = useState<"on" | "off">("on"), [fault, setFault] = useState<"crash" | "partition">("crash");
  const r = useMemo(() => {
    const faults = fault === "crash" ? [{ id: "f", kind: "fail-node", target: "db", atSec: 20 }] : [{ id: "f", kind: "partition-primary", target: "db", atSec: 20, untilSec: 70, params: { clientShare: 0.5 } }];
    const g = doc2([nd("c", "client", { readRatio: 0.8 }), nd("db", "replicated-db", { replicas, replication: mode, syncCopies: 1, syncRttMs: 20, detectSec: detect, promoteSec: promote, fencing: fence === "on", shipLagSec: 0.5 })], [ed("e", "c", "out", "db", "in", "database")]);
    const snaps = new Simulation(reg, g, sc2({ type: "constant", rps: 2500 }, 100, faults)).run(1000);
    return snaps;
  }, [mode, replicas, detect, promote, fence, fault]);
  const last = r.at(-1)!.nodes.db!;
  const events = r.flatMap((s) => s.events);
  return (
    <>
      <Title t="Replication & failover" d="2,500 req/s (20% writes). At 20 s the primary crashes — or is partitioned from its replicas. What do users see, and what is lost?" />
      <Seg label="Fault" value={fault} set={setFault} options={[["crash", "Primary crashes"], ["partition", "Primary partitioned (50 s)"]]} />
      <Seg label="Replication" value={mode} set={setMode} options={[["async", "Async"], ["sync", "Synchronous (1 copy)"]]} />
      <FieldRow field={num("r", "Replicas", 0, 5, 1)} value={replicas} onChange={(v) => setReplicas(Number(v))} />
      <FieldRow field={num("d", "Failure detection", 1, 60, 1, "s")} value={detect} onChange={(v) => setDetect(Number(v))} />
      <FieldRow field={num("p", "Promotion time", 1, 120, 1, "s")} value={promote} onChange={(v) => setPromote(Number(v))} />
      {fault === "partition" && <Seg label="Fence the old primary" value={fence} set={setFence} options={[["on", "Yes"], ["off", "No"]]} />}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat l="write downtime" v={`${last.downtimeSec!.toFixed(0)} s`} tone={last.downtimeSec! > 30 ? "bad" : "ok"} /><Stat l="writes lost" v={fmt(last.dataLoss!)} tone={last.dataLoss! > 0 ? "bad" : "ok"} /><Stat l="divergent writes" v={fmt(last.divergentWrites!)} tone={last.divergentWrites! > 0 ? "bad" : "ok"} /><Stat l="overall success" v={`${((1 - r.reduce((a, x) => a + x.global.droppedRps, 0) / Math.max(1, r.reduce((a, x) => a + x.global.droppedRps + x.global.throughputRps, 0))) * 100).toFixed(1)}%`} /></div>
      <Chart title="Writes available" percent xs={r.map((s) => s.time)} lines={[{ label: "available", color: "#4ade80", values: r.map((s) => s.nodes.db!.writeAvailable!) }]} height={70} />
      <ol className="mt-3 space-y-0.5 text-[12px] text-muted" aria-label="Events">{events.map((e, i) => <li key={i}><span className="mono text-faint">{e.time.toFixed(0)}s</span> {e.message}</li>)}</ol>
    </>
  );
}

function QuorumLab() {
  const [nodes, setNodes] = useState(6), [rf, setRf] = useState(3), [rcl, setRcl] = useState<"one" | "quorum" | "all">("quorum"), [wcl, setWcl] = useState<"one" | "quorum" | "all">("quorum"), [down, setDown] = useState(1);
  const r = useMemo(() => {
    const faults = Array.from({ length: down }, (_, i) => ({ id: `f${i}`, kind: "fail-node", target: "kv", atSec: 5, params: { index: i } }));
    const g = doc2([nd("c", "client", { readRatio: 0.7 }), nd("kv", "quorum-kv", { nodes, rf: Math.min(rf, nodes), readCL: rcl, writeCL: wcl })], [ed("e", "c", "out", "kv", "in", "tcp")]);
    return new Simulation(reg, g, sc2({ type: "constant", rps: 2000 }, 20, faults)).run(1000).at(-1)!.nodes.kv!;
  }, [nodes, rf, rcl, wcl, down]);
  const need = (cl: string) => (cl === "one" ? 1 : cl === "quorum" ? Math.floor(rf / 2) + 1 : rf);
  const strong = need(rcl) + need(wcl) > rf;
  const cl: [("one" | "quorum" | "all"), string][] = [["one", "One"], ["quorum", "Quorum"], ["all", "All"]];
  return (
    <>
      <Title t="Quorums & consistency" d="A Dynamo-style store. Reads wait for R replicas, writes for W. R + W > RF guarantees a read overlaps the latest write; more required replicas means fewer failures tolerated." />
      <FieldRow field={num("n", "Nodes", 3, 12, 1)} value={nodes} onChange={(v) => setNodes(Number(v))} />
      <FieldRow field={num("rf", "Replication factor", 1, 7, 1)} value={rf} onChange={(v) => setRf(Number(v))} />
      <Seg label="Read consistency" value={rcl} set={setRcl} options={cl} /><Seg label="Write consistency" value={wcl} set={setWcl} options={cl} />
      <FieldRow field={num("d", "Nodes down", 0, 6, 1)} value={down} onChange={(v) => setDown(Number(v))} />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat l="R + W vs RF" v={`${need(rcl) + need(wcl)} vs ${rf}`} tone={strong ? "ok" : "bad"} /><Stat l="consistency" v={strong ? "strong" : "eventual"} tone={strong ? "ok" : "bad"} /><Stat l="operations that succeed" v={`${(r.availability! * 100).toFixed(0)}%`} tone={r.availability! < 0.99 ? "bad" : "ok"} /><Stat l="stale reads" v={`${(r.staleReadRate! * 100).toFixed(1)}%`} tone={r.staleReadRate! > 0.02 ? "bad" : "ok"} /></div>
      <p className="mt-3 text-[12px] text-faint">This is the CAP/PACELC trade-off made concrete: strong consistency needs overlapping replica sets, which costs availability when replicas are down and latency when they are slow. “Operations that succeed” averages over random replica sets for uniformly distributed keys.</p>
    </>
  );
}
