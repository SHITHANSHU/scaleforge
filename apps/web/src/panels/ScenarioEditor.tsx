import { rovingKeys } from "../lib/roving";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Scenario, TrafficProfile } from "@scaleforge/engine";
import { useStore } from "../state/store";
import { registry } from "../lib/registry";
import { FieldRow } from "./fields";
import { fmtTime } from "../lib/format";

const num = (key: string, label: string, min: number, max: number, unit?: string, step = 1) => ({ key, label, type: "number" as const, min, max, step, unit, scale: max / Math.max(min, 1) > 1000 ? ("log" as const) : ("linear" as const) });

const profiles: { id: TrafficProfile["type"]; label: string; hint: string; make(rps: number): TrafficProfile }[] = [
  { id: "constant", label: "Constant", hint: "Steady baseline.", make: (r) => ({ type: "constant", rps: r }) },
  { id: "ramp", label: "Ramp", hint: "Linear climb — find the breaking point.", make: (r) => ({ type: "ramp", fromRps: r / 10, toRps: r }) },
  { id: "step", label: "Step", hint: "Sudden jump — tests autoscaling and warm-up.", make: (r) => ({ type: "step", baseRps: r / 5, stepRps: r, atSec: 30 }) },
  { id: "spike", label: "Spike", hint: "Short burst — flash sale, push fan-out.", make: (r) => ({ type: "spike", baseRps: r / 5, spikeRps: r, atSec: 30, widthSec: 15 }) },
];
const peak = (p: TrafficProfile) => (p.type === "constant" ? p.rps : p.type === "ramp" ? p.toRps : p.type === "step" ? p.stepRps : p.type === "pulses" ? p.peakRps : p.spikeRps);

export function ScenarioEditor() {
  const sc = useStore((s) => s.doc.scenario);
  const nodes = useStore((s) => s.doc.nodes);
  const edges = useStore((s) => s.doc.edges);
  const { setScenario, addFault, removeFault, commit } = useStore.getState();
  const set = (patch: Partial<Scenario>, o?: { commit?: boolean }) => { if (o?.commit === false) useStore.setState((s) => { Object.assign(s.doc.scenario, patch); }); else setScenario({ ...sc, ...patch }); };
  const t = sc.traffic;
  const setT = (patch: Partial<TrafficProfile>, o?: { commit?: boolean }) => set({ traffic: { ...t, ...patch } as TrafficProfile }, o);
  const [fk, setFk] = useState("kill-node"), [ft, setFt] = useState(""), [fa, setFa] = useState(30), [fu, setFu] = useState(0);
  void commit;

  const targets = nodes.filter((n) => n.kind !== "boundary");
  const target = ft && (targets.some((n) => n.id === ft) || edges.some((e) => e.id === ft)) ? ft : targets[0]?.id ?? "";
  const targetKind = nodes.find((n) => n.id === target)?.kind;
  const kinds = [
    { kind: "kill-node", label: "Kill node", edge: false },
    { kind: "edge-latency", label: "Add edge latency", edge: true },
    ...(registry.get(targetKind ?? "")?.faults?.map((f) => ({ kind: f.kind, label: f.label, edge: false })) ?? []),
  ];
  const isEdge = kinds.find((k) => k.kind === fk)?.edge;
  const tgt = isEdge ? (edges.some((e) => e.id === ft) ? ft : edges[0]?.id ?? "") : target;
  const nm = (id: string) => nodes.find((n) => n.id === id)?.label ?? registry.get(nodes.find((n) => n.id === id)?.kind ?? "")?.name ?? edges.find((e) => e.id === id) ? `edge ${id.slice(-3)}` : id;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-3">
      <div className="text-[10.5px] uppercase tracking-wider text-faint">Scenario</div>
      <input value={sc.name} onChange={(e) => set({ name: e.target.value })} aria-label="Scenario name" className="mt-1 w-full rounded bg-transparent text-[14px] font-medium outline-none focus:bg-bg" />
      <p className="mt-1 text-[11.5px] text-muted">Select a component on the canvas to configure it. This panel shows the load test.</p>

      <h3 className="mb-1 mt-4 text-[10.5px] font-medium uppercase tracking-wider text-faint">Traffic profile</h3>
      <div role="radiogroup" aria-label="Traffic profile" onKeyDown={rovingKeys} className="grid grid-cols-4 gap-0.5 rounded-md border border-line bg-bg p-0.5">
        {profiles.map((p) => (
          <button key={p.id} role="radio" tabIndex={t.type === p.id ? 0 : -1} aria-checked={t.type === p.id} onClick={() => set({ traffic: p.make(Math.max(peak(t), 10)) })} className={`rounded px-1 py-1 text-[11.5px] ${t.type === p.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{p.label}</button>
        ))}
      </div>
      <div className="mt-1 text-[11px] text-faint">{profiles.find((p) => p.id === t.type)?.hint}</div>
      {t.type === "constant" && <FieldRow field={num("rps", "Requests / second", 1, 1_000_000, "rps")} value={t.rps} onChange={(v, o) => setT({ rps: Number(v) }, o)} />}
      {t.type === "ramp" && <><FieldRow field={num("from", "From", 1, 1_000_000, "rps")} value={t.fromRps} onChange={(v, o) => setT({ fromRps: Number(v) }, o)} /><FieldRow field={num("to", "To", 1, 1_000_000, "rps")} value={t.toRps} onChange={(v, o) => setT({ toRps: Number(v) }, o)} /></>}
      {t.type === "step" && <><FieldRow field={num("base", "Base", 1, 1_000_000, "rps")} value={t.baseRps} onChange={(v, o) => setT({ baseRps: Number(v) }, o)} /><FieldRow field={num("step", "After step", 1, 1_000_000, "rps")} value={t.stepRps} onChange={(v, o) => setT({ stepRps: Number(v) }, o)} /><FieldRow field={num("at", "Step at", 0, 3600, "s")} value={t.atSec} onChange={(v, o) => setT({ atSec: Number(v) }, o)} /></>}
      {t.type === "spike" && <><FieldRow field={num("base", "Base", 1, 1_000_000, "rps")} value={t.baseRps} onChange={(v, o) => setT({ baseRps: Number(v) }, o)} /><FieldRow field={num("spike", "Spike", 1, 1_000_000, "rps")} value={t.spikeRps} onChange={(v, o) => setT({ spikeRps: Number(v) }, o)} /><FieldRow field={num("at", "Spike at", 0, 3600, "s")} value={t.atSec} onChange={(v, o) => setT({ atSec: Number(v) }, o)} /><FieldRow field={num("w", "Duration", 1, 600, "s")} value={t.widthSec} onChange={(v, o) => setT({ widthSec: Number(v) }, o)} /></>}

      <h3 className="mb-0.5 mt-4 text-[10.5px] font-medium uppercase tracking-wider text-faint">Run</h3>
      <FieldRow field={num("dur", "Duration", 10, 3600, "s")} value={sc.durationSec} onChange={(v, o) => set({ durationSec: Number(v) }, o)} />
      <FieldRow field={{ key: "seed", label: "Random seed", type: "number", min: 0, max: 999999, step: 1, control: "input", help: "Same design + scenario + seed = identical run." }} value={sc.seed} onChange={(v) => set({ seed: Number(v) })} />

      <h3 className="mb-1 mt-4 text-[10.5px] font-medium uppercase tracking-wider text-faint">Failure injection</h3>
      {sc.faults.length === 0 && <div className="text-[11.5px] text-faint">No faults. Add one to see how the design copes.</div>}
      <ul className="space-y-1">
        {sc.faults.map((f) => (
          <li key={f.id} className="flex items-center gap-2 rounded-md bg-bg px-2 py-1 text-[11.5px]">
            <span className="mono text-faint">{fmtTime(f.atSec)}{f.untilSec ? `–${fmtTime(f.untilSec)}` : ""}</span>
            <span className="min-w-0 flex-1 truncate">{f.kind} · {nm(f.target)}{f.params?.addMs ? ` +${f.params.addMs}ms` : ""}</span>
            <button aria-label="Remove fault" onClick={() => removeFault(f.id)} className="text-faint hover:text-bad"><X size={13} /></button>
          </li>
        ))}
      </ul>
      {targets.length > 0 && (
        <div className="mt-2 space-y-1.5 rounded-md border border-line p-2">
          <select aria-label="Fault type" value={fk} onChange={(e) => setFk(e.target.value)} className="w-full rounded border border-line bg-bg px-1.5 py-1 text-[11.5px]">{kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select>
          <select aria-label="Fault target" value={tgt} onChange={(e) => setFt(e.target.value)} className="w-full rounded border border-line bg-bg px-1.5 py-1 text-[11.5px]">
            {(isEdge ? edges.map((e) => ({ id: e.id, l: `${nm(e.from)} → ${nm(e.to)}` })) : targets.map((n) => ({ id: n.id, l: n.label ?? registry.get(n.kind)?.name ?? n.id }))).map((o) => <option key={o.id} value={o.id}>{o.l}</option>)}
          </select>
          <div className="flex items-center gap-2 text-[11.5px] text-muted">
            at <input type="number" aria-label="Start second" value={fa} min={0} onChange={(e) => setFa(Number(e.target.value))} className="mono w-14 rounded border border-line bg-bg px-1 py-0.5" /> s
            until <input type="number" aria-label="End second (0 = permanent)" value={fu} min={0} onChange={(e) => setFu(Number(e.target.value))} className="mono w-14 rounded border border-line bg-bg px-1 py-0.5" /> s <span className="text-faint">(0 = end)</span>
          </div>
          <button disabled={!tgt} onClick={() => addFault({ kind: fk, target: tgt, atSec: fa, untilSec: fu > fa ? fu : undefined, params: fk === "edge-latency" ? { addMs: 200 } : undefined })} className="flex w-full items-center justify-center gap-1 rounded-md bg-accent-soft py-1 text-[11.5px] text-accent hover:bg-accent/20 disabled:opacity-40"><Plus size={13} /> Add fault</button>
        </div>
      )}
    </div>
  );
}
