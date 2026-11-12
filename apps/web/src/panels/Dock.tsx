import { rovingKeys } from "../lib/roving";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { useSim } from "../sim/sim-store";
import { useStore } from "../state/store";
import { registry } from "../lib/registry";
import { fmt, fmtMs, fmtTime, utilColor } from "../lib/format";
import { Chart, type Line } from "./Chart";

const SPEEDS = [1, 2, 5, 10, 25, 50, 100, 250];
type Tab = "metrics" | "timeline" | "bottlenecks";

export function Dock() {
  const status = useSim((s) => s.status), speed = useSim((s) => s.speed), time = useSim((s) => s.time), error = useSim((s) => s.error);
  const { run, pause, step, stop, setSpeed } = useSim.getState();
  const sc = useStore((s) => s.doc.scenario);
  const [tab, setTab] = useState<Tab>("metrics");
  const [open, setOpen] = useState(true);
  const g = useSim((s) => s.latest?.global);
  const running = status === "running";

  return (
    <section aria-label="Execution dock" className="shrink-0 border-t border-line bg-surface">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="flex items-center gap-1" role="toolbar" aria-label="Run controls">
          <button onClick={running ? pause : run} aria-label={running ? "Pause" : status === "paused" ? "Resume" : "Run"} title="Run / Pause (Space)"
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-accent-fg hover:brightness-110">
            {running ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}{running ? "Pause" : status === "paused" ? "Resume" : status === "done" ? "Re-run" : "Run"}
          </button>
          <button onClick={step} aria-label="Step 100 ms" title="Step 100 ms of simulated time (.)" className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"><StepForward size={15} /></button>
          <button onClick={stop} disabled={status === "idle"} aria-label="Reset" title="Reset run" className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-30"><RotateCcw size={14} /></button>
        </div>
        <label className="ml-1 flex items-center gap-1.5 text-[11.5px] text-muted">Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Simulation speed" className="mono rounded border border-line bg-bg px-1 py-0.5 text-[11.5px] text-fg">{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</select>
        </label>
        <div className="ml-2 hidden min-w-0 items-center gap-2 text-[11.5px] text-muted md:flex">
          <span className="truncate" title="Edit scenario by selecting nothing on the canvas">{sc.name}</span>
          <div className="h-1 w-28 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(time)} aria-valuemax={sc.durationSec}><div className="h-full bg-accent" style={{ width: `${Math.min(100, (time / sc.durationSec) * 100)}%` }} /></div>
          <span className="mono">{fmtTime(time)} / {fmtTime(sc.durationSec)}</span>
        </div>
        {error && <span className="text-[11.5px] text-warn">{error}</span>}
        <div className="ml-auto flex items-center gap-4">
          {g && (
            <div className="mono hidden items-center gap-4 text-[11.5px] lg:flex" aria-label="Live totals">
              <Stat l="offered" v={`${fmt(g.offeredRps)}/s`} /><Stat l="served" v={`${fmt(g.throughputRps)}/s`} />
              <Stat l="errors" v={`${(g.errorRate * 100).toFixed(1)}%`} tone={g.errorRate > 0.01 ? "bad" : undefined} />
              <Stat l="p50" v={fmtMs(g.p50)} /><Stat l="p99" v={fmtMs(g.p99)} tone={g.p99 > 1000 ? "warn" : undefined} />
              {g.costPerHour > 0 && <Stat l="cost" v={`$${g.costPerHour.toFixed(2)}/h`} />}
            </div>
          )}
          <div role="tablist" aria-label="Dock views" onKeyDown={rovingKeys} className="flex rounded-md bg-bg p-0.5">
            {(["metrics", "timeline", "bottlenecks"] as Tab[]).map((t) => (
              <button key={t} role="tab" tabIndex={tab === t ? 0 : -1} aria-selected={tab === t} onClick={() => { setTab(t); setOpen(true); }} className={`rounded px-2 py-0.5 text-[11.5px] capitalize ${tab === t ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>{t}</button>
            ))}
          </div>
          <button onClick={() => setOpen(!open)} aria-label={open ? "Collapse dock" : "Expand dock"} className="rounded p-1 text-muted hover:bg-hover">{open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
        </div>
      </div>
      {open && <div role="tabpanel" aria-label={tab} className="h-[212px] overflow-y-auto border-t border-line px-3 py-2">{tab === "metrics" ? <Metrics /> : tab === "timeline" ? <Timeline /> : <Bottlenecks />}</div>}
    </section>
  );
}

const Stat = ({ l, v, tone }: { l: string; v: string; tone?: "bad" | "warn" }) => (
  <span><span className="text-faint">{l} </span><span className={tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-fg"}>{v}</span></span>
);

function Idle({ text }: { text: string }) { return <div className="grid h-full place-items-center text-[12px] text-faint">{text}</div>; }

function Metrics() {
  const history = useSim((s) => s.history);
  const status = useSim((s) => s.status);
  const selId = useStore((s) => s.selection.nodes[0]);
  const node = useStore((s) => s.doc.nodes.find((n) => n.id === selId));
  const data = useMemo(() => {
    const xs = history.map((h) => h.time);
    const g = (f: (h: (typeof history)[number]) => number): (number | null)[] => history.map(f);
    const glob: { title: string; unit?: string; lines: Line[]; percent?: boolean }[] = [
      { title: "Traffic", unit: "req/s", lines: [{ label: "offered", color: "#94a3b8", values: g((h) => h.global.offeredRps), dash: [4, 3] }, { label: "served", color: "#4ade80", values: g((h) => h.global.throughputRps) }, { label: "dropped", color: "#f87171", values: g((h) => h.global.droppedRps) }] },
      { title: "Latency", unit: "ms", lines: [{ label: "p50", color: "#38bdf8", values: g((h) => h.global.p50) }, { label: "p95", color: "#fbbf24", values: g((h) => h.global.p95) }, { label: "p99", color: "#f87171", values: g((h) => h.global.p99) }] },
    ];
    const def = node ? registry.get(node.kind) : undefined;
    const nodeCharts = def && node && selId ? def.metrics.filter((m) => m.id !== "queueDepth").slice(0, 3).map((m, i) => ({
      title: `${node.label ?? def.name} · ${m.label}`, unit: m.unit === "%" ? undefined : m.unit, percent: m.unit === "%",
      lines: [{ label: m.label, color: ["#f59e0b", "#a78bfa", "#2dd4bf"][i % 3]!, values: g((h) => h.nodes[selId]?.[m.id] ?? 0) }],
    })) : [{ title: "Error rate", unit: undefined, percent: true, lines: [{ label: "errors", color: "#f87171", values: g((h) => h.global.errorRate) }] }];
    return { xs, charts: [...glob, ...nodeCharts] };
  }, [history, node, selId]);
  if (history.length < 2) return <Idle text={status === "idle" ? "Press Run (Space) to drive load through the design." : "Waiting for data…"} />;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 xl:grid-cols-4">
      {data.charts.map((c) => <Chart key={c.title} xs={data.xs} title={c.title} unit={c.unit} lines={c.lines} percent={c.percent} height={72} />)}
    </div>
  );
}

function Timeline() {
  const events = useSim((s) => s.events);
  if (!events.length) return <Idle text="Engine events — “credits exhausted”, “rebalance started”, node failures — appear here on a shared time axis." />;
  return (
    <ol className="space-y-0.5" aria-label="Event timeline">
      {[...events].reverse().map((e, i) => (
        <li key={i} className="flex items-baseline gap-3 text-[12px]">
          <span className="mono w-12 shrink-0 text-faint">{fmtTime(e.time)}</span>
          <span className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${e.severity === "error" ? "bg-bad" : e.severity === "warn" ? "bg-warn" : "bg-info"}`} />
          <span className="text-muted">{e.message}</span>
        </li>
      ))}
    </ol>
  );
}

function Bottlenecks() {
  const sat = useSim((s) => s.saturation);
  const nodes = useStore((s) => s.doc.nodes);
  const status = useSim((s) => s.status);
  const rows = Object.entries(sat).filter(([id]) => registry.get(nodes.find((n) => n.id === id)?.kind ?? "")?.category !== "traffic")
    .sort((a, b) => (a[1].firstAt ?? 1e9) - (b[1].firstAt ?? 1e9) || b[1].peak - a[1].peak);
  if (!rows.length) return <Idle text="After (or during) a run, nodes are ranked by when they hit their limit." />;
  const first = rows.find(([, s]) => s.firstAt !== undefined);
  const name = (id: string) => nodes.find((n) => n.id === id)?.label ?? registry.get(nodes.find((n) => n.id === id)?.kind ?? "")?.name ?? id;
  return (
    <div>
      <p className="mb-2 text-[12px]">{first ? <>First to saturate: <b className="text-bad">{name(first[0])}</b> at <span className="mono">{fmtTime(first[1].firstAt!)}</span>.</> : <span className="text-ok">No component reached its limit{status === "running" ? " yet" : ""}.</span>}</p>
      <ul className="space-y-1">
        {rows.map(([id, s]) => (
          <li key={id} className="flex items-center gap-3 text-[12px]">
            <span className="w-40 truncate">{name(id)}</span>
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-line"><div className="h-full" style={{ width: `${Math.min(100, s.peak * 100)}%`, background: utilColor(s.peak) }} /></div>
            <span className="mono w-12 text-muted">{Math.round(s.peak * 100)}%</span>
            <span className="mono text-faint">{s.firstAt !== undefined ? `saturated ${fmtTime(s.firstAt)}` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
