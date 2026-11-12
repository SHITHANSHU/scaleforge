import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, Copy, Trash2 } from "lucide-react";
import { checkConnection, validateConfig, type ComponentDefinition, type FieldSpec, type Scenario } from "@scaleforge/engine";
import { useStore } from "../state/store";
import { registry, useRegistry } from "../lib/registry";
import { Icon, categoryColor } from "../lib/icons";
import { useLint } from "../lib/lint";
import { FieldRow } from "./fields";
import { ScenarioEditor } from "./ScenarioEditor";
import { toast } from "../lib/toast";

export function Inspector() {
  useRegistry();
  const sel = useStore((s) => s.selection);
  const nodes = useStore((s) => s.doc.nodes);
  const rules = useStore((s) => s.rules);
  let body;
  if (sel.nodes.length === 1) {
    const n = nodes.find((x) => x.id === sel.nodes[0]);
    body = n ? (n.kind === "boundary" ? <BoundaryInspector id={n.id} /> : <NodeInspector id={n.id} />) : null;
  } else if (sel.nodes.length > 1) body = <MultiInspector count={sel.nodes.length} />;
  else if (sel.edges.length === 1) body = <EdgeInspector id={sel.edges[0]!} />;
  else body = rules ? <ScenarioReadOnly /> : <ScenarioEditor />;
  return <aside aria-label="Inspector" className="flex h-full w-[318px] shrink-0 flex-col border-l border-line bg-surface">{body}</aside>;
}

function Header({ children }: { children: React.ReactNode }) { return <div className="border-b border-line px-3.5 py-3">{children}</div>; }
export const SectionTitle = ({ children }: { children: React.ReactNode }) => <h3 className="mb-0.5 mt-3 text-[10.5px] font-medium uppercase tracking-wider text-faint">{children}</h3>;

function NodeInspector({ id }: { id: string }) {
  const node = useStore((s) => s.doc.nodes.find((n) => n.id === id)!);
  const { updateConfig, applyPreset, setLabel, deleteSelection, duplicate } = useStore.getState();
  const def = registry.get(node.kind) as ComponentDefinition<any, any> | undefined;
  const lint = useLint((s) => s.byNode[id]) ?? [];
  const locks = useStore((s) => s.locks);
  const nodeLocked = locks.includes(id);
  const kindLocked = useStore((s) => s.rules?.kindLocked[node.kind]) ?? [];
  const [docsOpen, setDocsOpen] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, FieldSpec[]>();
    for (const f of def?.fields ?? []) { const g = f.group ?? "General"; if (!m.has(g)) m.set(g, []); m.get(g)!.push(f); }
    return [...m];
  }, [def]);
  if (!def) return <Header><div className="text-bad">Component “{node.kind}” is not registered.</div></Header>;

  const presets = registry.presetsFor(node.kind);
  const active = presets.find((p) => Object.entries(p.values).every(([k, v]) => node.config[k] === v));
  const derived = def.derived?.(node.config) ?? [];
  const cfgIssues = validateConfig(def.fields, node.config);
  const issues = [...cfgIssues, ...lint];
  const color = categoryColor[def.category];

  return (
    <>
      <Header>
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md" style={{ background: `${color}22`, color }}><Icon name={def.icon} size={17} /></span>
          <div className="min-w-0 flex-1">
            <input value={node.label ?? ""} placeholder={def.name} onFocus={() => useStore.getState().commit()} onChange={(e) => setLabel(id, e.target.value)} aria-label="Component name"
              className="w-full truncate rounded bg-transparent text-[14px] font-medium outline-none placeholder:text-fg focus:bg-bg" />
            <div className="text-[11px] text-faint">{def.name} · v{def.version}</div>
          </div>
          <button onClick={duplicate} title="Duplicate (⌘D)" aria-label="Duplicate" className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg"><Copy size={14} /></button>
          <button onClick={deleteSelection} title="Delete (Del)" aria-label="Delete" className="rounded p-1.5 text-muted hover:bg-hover hover:text-bad"><Trash2 size={14} /></button>
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-muted">{def.description}</p>
      </Header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6">
        {(locks.some((l) => l === id || l.startsWith(`${id}.`)) || kindLocked.length > 0) && <div className="mt-3 rounded-md bg-warn/10 px-2 py-1 text-[11.5px] text-warn">{nodeLocked ? "Locked by the scenario." : "Some settings are fixed by the scenario (greyed out)."}</div>}
        {presets.length > 0 && (
          <>
            <SectionTitle>Presets</SectionTitle>
            <div className="flex flex-wrap gap-1.5 pb-1">
              {presets.map((p) => (
                <button key={p.id} onClick={() => applyPreset(id, p.values)} aria-pressed={active?.id === p.id}
                  title={`${p.approximate ? "Approximate · " : ""}${p.source?.title ?? "no source"} (v${p.version})`}
                  className={`rounded-md border px-2 py-1 text-[11.5px] ${active?.id === p.id ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:text-fg"}`}>{p.label}{p.approximate && <span className="ml-1 text-faint">≈</span>}</button>
              ))}
            </div>
            {active?.approximate && <div className="text-[11px] text-faint">≈ approximate — edit any value below. Source: {active.source?.title}</div>}
          </>
        )}

        {derived.length > 0 && (
          <div className="mt-3 rounded-md bg-bg px-2.5 py-1.5" aria-label="Derived values">
            {derived.map((d) => (
              <div key={d.label} className="py-1" title={d.help}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11.5px] text-muted">{d.label}</span>
                  <span className={`mono text-[12px] ${d.tone === "bad" ? "text-bad" : d.tone === "warn" ? "text-warn" : "text-fg"}`}>{d.value}</span>
                </div>
                {d.help && <div className="text-[10.5px] leading-snug text-faint">{d.help}</div>}
              </div>
            ))}
          </div>
        )}

        {issues.length > 0 && (
          <ul className="mt-3 space-y-1" aria-label="Design warnings">
            {issues.map((i, k) => (
              <li key={k} className={`rounded-md px-2 py-1 text-[11.5px] ${i.severity === "error" ? "bg-bad/10 text-bad" : i.severity === "warn" ? "bg-warn/10 text-warn" : "bg-info/10 text-info"}`}>{i.message}</li>
            ))}
          </ul>
        )}

        {groups.map(([g, fields]) => (
          <section key={g}>
            <SectionTitle>{g}</SectionTitle>
            {fields.filter((f) => !f.showIf || node.config[f.showIf.key] === f.showIf.equals).map((f) => (
              <FieldRow key={f.key} field={f} disabled={nodeLocked || locks.includes(`${id}.${f.key}`) || kindLocked.includes(f.key)} value={node.config[f.key]!} onChange={(v, o) => updateConfig(id, { [f.key]: v }, o)} />
            ))}
          </section>
        ))}

        <Connections id={id} />

        <button onClick={() => setDocsOpen(!docsOpen)} aria-expanded={docsOpen} className="mt-5 flex w-full items-center gap-1.5 text-[11.5px] text-muted hover:text-fg">
          <BookOpen size={13} /> How this is modeled <ChevronDown size={13} className={`ml-auto transition-transform ${docsOpen ? "rotate-180" : ""}`} />
        </button>
        {docsOpen && <DocsBlock def={def} />}
      </div>
    </>
  );
}

export function DocsBlock({ def }: { def: ComponentDefinition<any, any> }) {
  const d = def.docs;
  const List = ({ title, items }: { title: string; items: string[] }) => (
    <div className="mt-2"><div className="text-[10.5px] font-medium uppercase tracking-wider text-faint">{title}</div>
      <ul className="ml-3.5 list-disc text-[11.5px] leading-snug text-muted">{items.map((i) => <li key={i}>{i}</li>)}</ul></div>
  );
  return (
    <div className="mt-2 rounded-md bg-bg px-2.5 py-2">
      <p className="text-[11.5px] text-muted">{d.summary}</p>
      <List title="Models" items={d.models} /><List title="Simplifies" items={d.simplifies} /><List title="Failure scenarios" items={d.failureScenarios} />
      <div className="mt-2 text-[10.5px] font-medium uppercase tracking-wider text-faint">References</div>
      {d.references.map((r) => <div key={r.title} className="text-[11.5px]">{r.url ? <a className="text-info underline" target="_blank" rel="noreferrer" href={r.url}>{r.title}</a> : r.title}</div>)}
    </div>
  );
}

function BoundaryInspector({ id }: { id: string }) {
  const n = useStore((s) => s.doc.nodes.find((x) => x.id === id)!);
  const { setLabel, deleteSelection } = useStore.getState();
  return (
    <Header>
      <div className="text-[10.5px] uppercase tracking-wider text-faint">Boundary</div>
      <input value={n.label ?? ""} onChange={(e) => setLabel(id, e.target.value)} aria-label="Boundary name" className="mt-1 w-full rounded border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-accent" />
      <p className="mt-2 text-[11.5px] text-muted">A visual region (VPC, region, AZ). Dragging it moves the components inside. It does not change simulation behavior.</p>
      <button onClick={deleteSelection} className="mt-3 text-[11.5px] text-bad">Delete boundary</button>
    </Header>
  );
}

function MultiInspector({ count }: { count: number }) {
  const { duplicate, deleteSelection, groupSelection } = useStore.getState();
  return (
    <Header>
      <div className="text-[14px] font-medium">{count} selected</div>
      <div className="mt-3 flex flex-col gap-1.5">
        <button onClick={groupSelection} className="rounded-md border border-line-strong px-2 py-1.5 text-left text-[12px] hover:border-accent">Group in boundary <kbd className="mono float-right text-faint">⌘G</kbd></button>
        <button onClick={duplicate} className="rounded-md border border-line-strong px-2 py-1.5 text-left text-[12px] hover:border-accent">Duplicate <kbd className="mono float-right text-faint">⌘D</kbd></button>
        <button onClick={deleteSelection} className="rounded-md border border-line-strong px-2 py-1.5 text-left text-[12px] text-bad hover:border-bad">Delete <kbd className="mono float-right text-faint">Del</kbd></button>
      </div>
    </Header>
  );
}

function EdgeInspector({ id }: { id: string }) {
  const e = useStore((s) => s.doc.edges.find((x) => x.id === id));
  const nodes = useStore((s) => s.doc.nodes);
  const { updateEdge, deleteSelection } = useStore.getState();
  if (!e) return null;
  const p = registry.protocol(e.protocol);
  const name = (nid: string) => nodes.find((n) => n.id === nid)?.label ?? registry.get(nodes.find((n) => n.id === nid)?.kind ?? "")?.name ?? nid;
  return (
    <>
      <Header>
        <div className="text-[10.5px] uppercase tracking-wider text-faint">Connection</div>
        <div className="mt-1 text-[13px]">{name(e.from)} → {name(e.to)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted"><span className="h-2 w-2 rounded-full" style={{ background: p?.color }} />{p?.label}: {p?.description}</div>
      </Header>
      <div className="px-3.5">
        <FieldRow field={{ key: "latencyMs", label: "Network latency", type: "number", min: 0, max: 2000, step: 1, unit: "ms", help: "Added to every request crossing this edge." }} value={e.latencyMs ?? 0} onChange={(v, o) => updateEdge(id, { latencyMs: Number(v) }, o)} />
        <FieldRow field={{ key: "maxRps", label: "Bandwidth cap", type: "number", min: 0, max: 1e7, step: 100, unit: "req/s", help: "0 = unlimited. Excess is dropped." }} value={e.maxRps ?? 0} onChange={(v) => updateEdge(id, { maxRps: Number(v) || undefined })} />
        <button onClick={deleteSelection} className="mt-4 text-[11.5px] text-bad">Delete connection</button>
      </div>
    </>
  );
}
export type { Scenario };

/** Keyboard- and screen-reader-friendly alternative to dragging handles. */
function Connections({ id }: { id: string }) {
  const nodes = useStore((s) => s.doc.nodes);
  const edges = useStore((s) => s.doc.edges);
  const me = nodes.find((n) => n.id === id)!;
  const [target, setTarget] = useState("");
  const name = (n: { id: string; kind: string; label?: string }) => n.label ?? registry.get(n.kind)?.name ?? n.id;
  const options = nodes.filter((n) => n.id !== id && n.kind !== "boundary").flatMap((n) =>
    (registry.get(me.kind)?.ports ?? []).filter((p) => p.direction === "out" && !p.hidden).flatMap((out) =>
      (registry.get(n.kind)?.ports ?? []).filter((p) => p.direction === "in").flatMap((inn) => {
        const c = checkConnection(registry, me.kind, out.id, n.kind, inn.id);
        return c.ok && !edges.some((e) => e.from === id && e.fromPort === out.id && e.to === n.id && e.toPort === inn.id)
          ? [{ key: `${n.id}|${out.id}|${inn.id}`, label: `${out.label} → ${name(n)} · ${inn.label}`, n, out: out.id, inn: inn.id }] : [];
      })));
  const mine = edges.filter((e) => e.from === id || e.to === id);
  const sel = options.find((o) => o.key === target) ?? options[0];
  return (
    <section aria-label="Connections">
      <SectionTitle>Connections</SectionTitle>
      <ul className="space-y-1">
        {mine.map((e) => {
          const other = nodes.find((n) => n.id === (e.from === id ? e.to : e.from));
          return (
            <li key={e.id} className="flex items-center gap-2 rounded-md bg-bg px-2 py-1 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate">{e.from === id ? "→" : "←"} {other ? name(other) : "?"} <span className="text-faint">{registry.protocol(e.protocol)?.label}</span></span>
              <button onClick={() => { useStore.getState().select([], [e.id]); useStore.getState().deleteSelection(); toast("Connection removed"); }} aria-label={`Remove connection ${e.from === id ? "to" : "from"} ${other ? name(other) : ""}`} className="text-faint hover:text-bad">Remove</button>
            </li>
          );
        })}
        {mine.length === 0 && <li className="text-[11.5px] text-faint">Not connected. Drag from a handle, or connect below.</li>}
      </ul>
      {options.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          <select aria-label="Connect to" value={sel?.key} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-bg px-1.5 py-1 text-[11.5px]">
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button onClick={() => { if (!sel) return; const r = useStore.getState().connect({ source: id, sourceHandle: sel.out, target: sel.n.id, targetHandle: sel.inn }); toast(r.ok ? `Connected to ${name(sel.n)}` : r.reason ?? "Can't connect", r.ok ? "ok" : "warn"); }} className="rounded-md bg-accent-soft px-2.5 py-1 text-[11.5px] text-accent hover:bg-accent/20">Connect</button>
        </div>
      )}
    </section>
  );
}

/** In an open-ended challenge the load test is part of the problem, so it can be inspected but not edited. */
function ScenarioReadOnly() {
  const sc = useStore((s) => s.doc.scenario);
  const nodes = useStore((s) => s.doc.nodes);
  const t = sc.traffic;
  const traffic = t.type === "constant" ? `${t.rps.toLocaleString()} req/s steady` : t.type === "ramp" ? `ramp ${t.fromRps.toLocaleString()} → ${t.toRps.toLocaleString()} req/s` : t.type === "step" ? `${t.baseRps.toLocaleString()} → ${t.stepRps.toLocaleString()} req/s at ${t.atSec}s` : t.type === "spike" ? `${t.baseRps.toLocaleString()} req/s, spike to ${t.spikeRps.toLocaleString()} at ${t.atSec}s for ${t.widthSec}s` : `${t.baseRps.toLocaleString()} req/s with ${t.count} bursts to ${t.peakRps.toLocaleString()}`;
  const name = (id: string) => id.startsWith("kind:") ? `any ${registry.get(id.slice(5))?.name ?? id.slice(5)}` : nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-3">
      <div className="text-[10.5px] uppercase tracking-wider text-faint">Scenario (fixed)</div>
      <div className="mt-1 text-[14px] font-medium">{sc.name}</div>
      <p className="mt-1 text-[11.5px] text-muted">The load test is part of the problem. Select a component to configure it; pick a scenario in the challenge panel.</p>
      <dl className="mt-3 space-y-1.5 text-[12px]">
        <div className="flex justify-between gap-3"><dt className="text-muted">Traffic</dt><dd className="mono text-right">{traffic}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Duration</dt><dd className="mono">{sc.durationSec} s</dd></div>
        {sc.timeoutMs && <div className="flex justify-between gap-3"><dt className="text-muted">Client timeout</dt><dd className="mono">{sc.timeoutMs} ms</dd></div>}
        {sc.regionRttMs && <div className="flex justify-between gap-3"><dt className="text-muted">Cross-region round trip</dt><dd className="mono">{sc.regionRttMs} ms</dd></div>}
      </dl>
      {sc.faults.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-[10.5px] font-medium uppercase tracking-wider text-faint">Faults during the run</h3>
          <ul className="space-y-1">{sc.faults.map((f) => <li key={f.id} className="rounded-md bg-bg px-2 py-1 text-[11.5px]"><span className="mono text-faint">{f.atSec}s{f.untilSec ? `–${f.untilSec}s` : ""}</span> {f.kind.replace(/-/g, " ")} · {name(f.target)}</li>)}</ul>
        </>
      )}
    </div>
  );
}
