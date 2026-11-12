import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleAlert, Lightbulb, Loader2, X } from "lucide-react";
import type { OpenChallenge, OpenCriterionResult } from "@scaleforge/engine";
import { useOpen } from "../challenges/open-store";
import { useSim } from "../sim/sim-store";
import { useStore } from "../state/store";
import { registry } from "../lib/registry";
import { fmtMs } from "../lib/format";

type Tab = "brief" | "results";

/** Floats over the canvas: the situation, constraints, live cost, and — after evaluating — what actually happened. */
export function OpenChallengePanel() {
  const o = useOpen();
  const designId = useStore((s) => s.id);
  const cost = useSim((s) => s.latest?.global.costPerHour);
  const [tab, setTab] = useState<Tab>("brief");
  const [min, setMin] = useState(false);
  useEffect(() => { if (o.result) setTab("results"); }, [o.result]);
  const hydrate = o.hydrate;
  useEffect(() => { void hydrate(); }, [hydrate]);
  const ch = o.active;
  if (!ch || !designId.startsWith(`oc-${ch.id}`) || designId.includes("-reference-")) return null;
  const budget = ch.resources.budget?.maxCostPerHour;
  const solved = o.solved[ch.id];

  if (min) return (
    <div className="flex h-full w-11 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-2" role="complementary" aria-label="Challenge (collapsed)">
      <button onClick={() => setMin(false)} aria-label="Expand challenge" title={ch.title} className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg"><ChevronRight size={16} /></button>
      <span className="mt-1 text-[11px] font-medium text-faint [writing-mode:vertical-rl]">{ch.title}</span>
    </div>
  );
  return (
    <div className="flex h-full w-[372px] shrink-0 flex-col border-r border-line bg-surface" role="complementary" aria-label="Challenge">
      <div className="flex items-start gap-2 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-faint">{ch.category} · {ch.level} · ~{ch.estimatedMinutes} min {solved && <span className="text-ok">· solved ({Math.round(solved.score)})</span>}</div>
          <div className="text-[13.5px] font-medium leading-tight">{ch.title}</div>
        </div>
        <button onClick={() => setMin(!min)} aria-label="Collapse challenge" className="rounded p-1 text-faint hover:bg-hover"><ChevronLeft size={14} /></button>
        <button onClick={o.exit} aria-label="Leave challenge" className="rounded p-1 text-faint hover:bg-hover"><X size={14} /></button>
      </div>
      {(
        <>
          <div role="tablist" aria-label="Challenge sections" className="flex gap-1 border-b border-line px-3 pt-1.5">
            {(["brief", "results"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} disabled={t === "results" && !o.result}
                className={`rounded-t px-2.5 py-1 text-[12px] capitalize ${tab === t ? "border-b-2 border-accent text-fg" : "text-muted hover:text-fg disabled:opacity-40"}`}>{t === "results" && o.result ? `Results · ${Math.round(o.result.score)}` : t}</button>
            ))}
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3 text-[12px]">
            {tab === "brief" ? <Brief ch={ch} cost={cost} budget={budget} /> : o.result ? <Results /> : null}
          </div>
          <div className="flex items-center gap-2 border-t border-line px-3.5 py-2">
            <button onClick={() => void o.evaluate()} disabled={o.evaluating} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-accent-fg hover:brightness-110 disabled:opacity-60">
              {o.evaluating && <Loader2 size={12} className="animate-spin" />}{o.evaluating ? "Evaluating…" : "Evaluate design"}
            </button>
            <span className="text-[11px] leading-tight text-faint">Runs every scenario, including ones you haven’t seen.</span>
          </div>
        </>
      )}
    </div>
  );
}

const Bullets = ({ items }: { items: string[] }) => <ul className="ml-3.5 list-disc space-y-0.5 text-muted">{items.map((i) => <li key={i}>{i}</li>)}</ul>;
const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-faint">{children}</h4>;

function Brief({ ch, cost, budget }: { ch: OpenChallenge; cost?: number; budget?: number }) {
  const o = useOpen();
  const result = o.result;
  return (
    <>
      <p className="leading-snug text-fg">{ch.statement.situation}</p>
      <div><H>What you’re seeing</H><Bullets items={ch.statement.symptoms} /></div>
      <div><H>Requirements</H><Bullets items={ch.statement.requirements} /></div>
      <div><H>Constraints</H><Bullets items={ch.statement.constraints} /></div>
      {ch.background && <p className="rounded-md bg-bg px-2.5 py-1.5 text-muted">{ch.background}</p>}

      <div>
        <H>How you’ll be judged</H>
        <ul className="space-y-1">{ch.successCriteria.map((c) => <li key={c.id} className="flex gap-1.5 text-muted"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />{c.label}</li>)}</ul>
      </div>

      <div>
        <H>Scenario to run</H>
        <div role="radiogroup" aria-label="Scenario" className="space-y-1">
          {ch.scenarios.map((s) => (
            <button key={s.id} role="radio" aria-checked={o.scenarioId === s.id} onClick={() => o.pickScenario(s.id)} className={`w-full rounded-md border px-2.5 py-1.5 text-left ${o.scenarioId === s.id ? "border-accent bg-accent-soft" : "border-line-strong hover:border-faint"}`}>
              <div className="font-medium">{s.name}</div><div className="text-[11px] text-muted">{s.description}</div>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-faint">Run it from the dock to watch what happens. Evaluation also tries scenarios that aren’t listed here.</p>
      </div>

      {budget !== undefined && (
        <div>
          <H>Budget</H>
          <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full" style={{ width: `${Math.min(100, ((cost ?? 0) / budget) * 100)}%`, background: (cost ?? 0) > budget ? "var(--bad)" : "var(--ok)" }} /></div>
            <span className="mono text-[11px] text-muted">${(cost ?? 0).toFixed(2)} / ${budget.toFixed(2)} per hour</span></div>
          <p className="mt-0.5 text-[11px] text-faint">Shown while a run is in progress; evaluation uses peak spend.</p>
        </div>
      )}

      <div>
        <H>Available components</H>
        <div className="flex flex-wrap gap-1">{(ch.resources.allowed ?? registry.list().map((d) => d.kind)).map((k) => <span key={k} className="rounded bg-bg px-1.5 py-0.5 text-[11px] text-muted">{registry.get(k)?.name ?? k}</span>)}</div>
        {ch.resources.fixed.length > 0 && <p className="mt-1 text-[11px] text-faint">Already on the canvas and locked: {ch.resources.fixed.filter((f) => f.kind !== "boundary").map((f) => f.label ?? f.id).join(", ")}. Fixed settings are greyed out in the inspector.</p>}
      </div>

      {ch.hints && ch.hints.length > 0 && (
        <div>
          <H>Hints (optional)</H>
          {o.hints > 0 && <ol className="mb-1.5 space-y-1">{ch.hints.slice(0, o.hints).map((h, i) => <li key={i} className="flex gap-1.5 text-muted"><Lightbulb size={12} className="mt-0.5 shrink-0 text-warn" />{h}</li>)}</ol>}
          <button onClick={o.hint} disabled={o.hints >= ch.hints.length} className="rounded-md border border-line-strong px-2.5 py-1 text-[11.5px] text-muted hover:text-fg disabled:opacity-40">{o.hints === 0 ? "Show a hint" : "Another hint"} ({o.hints}/{ch.hints.length})</button>
        </div>
      )}
      {result === null && o.error && <p className="rounded bg-bad/10 px-2 py-1 text-bad">{o.error}</p>}
    </>
  );
}

/** Format an observed value for humans, using what the metric is. */
function fmtVal(metric: string, v: number): string {
  if (!Number.isFinite(v)) return v === Infinity ? "never" : "–";
  if (/availability|errorRate|duplicateRate|staleReadRate|goodput/.test(metric)) return `${(v * (metric.includes("availability") || metric.includes("goodput") ? 100 : 100)).toFixed(v < 0.1 ? 2 : 1)}%`;
  if (/\.p(50|95|99)$/.test(metric) || /latencyMs/.test(metric)) return fmtMs(v);
  if (/Sec$|freshness/.test(metric)) return `${v.toFixed(v < 10 ? 1 : 0)} s`;
  if (/costPerHour/.test(metric)) return `$${v.toFixed(2)}/h`;
  if (/retryRatio/.test(metric)) return `${v.toFixed(2)}×`;
  return v >= 1000 ? `${Math.round(v).toLocaleString()}` : v.toPrecision(3).replace(/\.?0+$/, "");
}
const fmtTarget = (r: OpenCriterionResult) => { const c = r.criterion; const v = c.agg === "settleSec" ? `${c.value} s` : fmtVal(c.metric, c.value); return `${c.op} ${v}`; };

function Results() {
  const o = useOpen();
  const g = o.result!;
  const [confirm, setConfirm] = useState(false);
  const byCriterion = new Map<string, OpenCriterionResult[]>();
  for (const r of g.results) { const l = byCriterion.get(r.criterion.id) ?? []; l.push(r); byCriterion.set(r.criterion.id, l); }
  const names = new Map(g.runs.map((r) => [r.id, r]));
  const all = [...byCriterion.values()];
  return (
    <>
      <div className={`rounded-lg border px-3 py-2.5 ${g.pass ? "border-ok/40 bg-ok/10" : "border-warn/40 bg-warn/10"}`}>
        <div className="flex items-baseline gap-2">
          <span className="mono text-[24px] font-semibold">{Math.round(g.score)}</span><span className="text-faint">/ 100</span>
          <span className={`ml-auto text-[13px] font-medium ${g.pass ? "text-ok" : "text-warn"}`}>{g.pass ? "Meets the requirements" : g.valid ? "Doesn’t meet the requirements yet" : "Can’t be evaluated"}</span>
        </div>
        {g.hardFailures.length > 0 && <p className="mt-1 text-[11.5px] text-bad">Must-haves not met: {g.hardFailures.join("; ")}</p>}
      </div>

      {g.problems.length > 0 && (
        <ul className="space-y-1" aria-label="Problems with the design">
          {g.problems.map((p, i) => <li key={i} className="flex gap-1.5 rounded bg-bad/10 px-2 py-1 text-bad"><CircleAlert size={13} className="mt-0.5 shrink-0" />{p}</li>)}
        </ul>
      )}

      <div>
        <H>Scenarios tried</H>
        <ul className="space-y-0.5 text-muted">{g.runs.map((r) => <li key={r.id}>{r.hidden ? "◌ " : "● "}{r.name}{r.hidden && <span className="text-faint"> (not shown before)</span>}<span className="mono ml-1 text-faint">peak ${r.cost.toFixed(2)}/h</span></li>)}</ul>
      </div>

      {all.length > 0 && (
        <div>
          <H>Criteria</H>
          <ul className="space-y-2.5">
            {all.map((rs) => {
              const c = rs[0]!.criterion; const pass = rs.every((r) => r.pass);
              return (
                <li key={c.id}>
                  <div className="flex items-start gap-1.5">
                    {pass ? <Check size={13} className="mt-0.5 shrink-0 text-ok" /> : <CircleAlert size={13} className={`mt-0.5 shrink-0 ${c.hard ? "text-bad" : "text-warn"}`} />}
                    <span className={pass ? "text-fg" : "text-fg"}>{c.label}{c.hard && <span className="ml-1 rounded bg-bg px-1 text-[10px] text-faint">must-have</span>}</span>
                  </div>
                  {(!pass || rs.length > 1) && (
                    <ul className="ml-5 mt-0.5 space-y-0.5">
                      {rs.map((r) => (
                        <li key={r.scenario} className="flex items-baseline gap-2 text-[11.5px]">
                          <span className={`w-14 shrink-0 mono ${r.pass ? "text-ok" : "text-bad"}`}>{fmtVal(c.metric, r.actual)}</span>
                          <span className="text-faint">needs {fmtTarget(r)}</span>
                          <span className="ml-auto truncate text-faint">{names.get(r.scenario)?.name ?? r.scenario}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!g.pass && g.valid && <p className="rounded-md bg-bg px-2.5 py-1.5 text-muted">Open the dock’s <b>Timeline</b> and <b>Bottlenecks</b> for the scenario above to see where it broke, change the design, and evaluate again.</p>}

      <div className="border-t border-line pt-2">
        {o.revealed ? (
          <div className="rounded-md bg-bg p-2.5">
            <H>Write-up: trade-offs</H>
            <p className="whitespace-pre-line leading-snug text-muted">{o.revealed.writeup}</p>
            <button onClick={() => void o.loadReference()} className="mt-2 text-info underline">Open the reference design on the canvas</button>
            <span className="ml-2 text-[11px] text-faint">(leaves your design; it stays saved under Home)</span>
          </div>
        ) : g.pass || confirm ? (
          <button onClick={() => void o.reveal()} className="rounded-md border border-line-strong px-2.5 py-1 text-[11.5px] hover:border-accent">{g.pass ? "Read the write-up and compare designs" : "Show me the write-up and a reference design"}</button>
        ) : (
          <button onClick={() => setConfirm(true)} className="text-[11.5px] text-faint underline">I’m stuck</button>
        )}
        <p className="mt-1 text-[11px] text-faint">Multiple designs can satisfy the requirements; the write-up describes one and its alternatives.</p>
      </div>
    </>
  );
}
