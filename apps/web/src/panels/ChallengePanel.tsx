import { useMemo, useState } from "react";
import { Check, Circle, Lightbulb, Lock, X } from "lucide-react";
import { evaluate } from "@scaleforge/engine";
import { useChallenge } from "../challenges/challenge-store";
import { useSim, engineDoc } from "../sim/sim-store";
import { fmt } from "../lib/format";
import { lessons } from "../challenges/lessons";
import { useStore } from "../state/store";

/** Brief, live criteria checklist, budget meter, hints, grading. Floats over the canvas. */
export function ChallengePanel() {
  const { active, hintsShown, grade, violations, grading, showHint, submit, exit, loadSolution, passed } = useChallenge();
  const history = useSim((s) => s.history);
  const status = useSim((s) => s.status);
  const live = useMemo(() => (active && history.length ? evaluate(active.ch, history, engineDoc()) : null), [active, history]);
  const [min, setMin] = useState(false);
  const designId = useStore((st) => st.id);
  if (!active || !designId.startsWith(`ch-${active.ch.id}`)) return null;
  const { ch } = active;
  const done = !!passed[ch.id];
  const results = grade?.results ?? live?.results;
  const cost = live?.cost ?? 0;

  return (
    <div className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-24px)] w-[300px] flex-col rounded-xl border border-line-strong bg-raised/95 shadow-xl backdrop-blur" role="complementary" aria-label="Challenge">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-faint">{ch.level} challenge {done && <span className="text-ok">· solved</span>}</div>
          <div className="text-[13.5px] font-medium leading-tight">{ch.title}</div>
        </div>
        <button onClick={() => setMin(!min)} aria-label={min ? "Expand challenge" : "Collapse challenge"} className="rounded p-1 text-faint hover:bg-hover">{min ? "▾" : "▴"}</button>
        <button onClick={exit} aria-label="Leave challenge" className="rounded p-1 text-faint hover:bg-hover"><X size={14} /></button>
      </div>
      {!min && <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5 text-[12px]">
        <p className="whitespace-pre-line leading-snug text-muted">{active.brief.replace(/^#.*\n+/, "").replace(/\*\*/g, "")}</p>
        {ch.locked.length > 0 && <div className="flex items-start gap-1.5 text-faint"><Lock size={12} className="mt-0.5 shrink-0" /><span>Locked: {ch.locked.join(", ")}</span></div>}

        {lessons[ch.id] && <LessonView id={ch.id} />}

        <div>
          <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-faint">Success criteria</div>
          <ul className="space-y-1" aria-label="Criteria">
            {ch.criteria.map((c, i) => {
              const r = results?.[i];
              return (
                <li key={i} className="flex items-start gap-1.5">
                  {r?.pass ? <Check size={13} className="mt-0.5 shrink-0 text-ok" /> : <Circle size={13} className={`mt-0.5 shrink-0 ${r ? "text-bad" : "text-faint"}`} />}
                  <span className={r?.pass ? "text-fg" : "text-muted"}>{c.label ?? `${c.metric} ${c.op} ${c.value}`}
                    {r && Number.isFinite(r.actual) && <span className="mono ml-1 text-faint">({fmt(r.actual)})</span>}</span>
                </li>
              );
            })}
            {ch.budget && (
              <li className="flex items-start gap-1.5">
                {(grade?.budgetOk ?? cost <= ch.budget.maxCostPerHour) ? <Check size={13} className="mt-0.5 text-ok" /> : <Circle size={13} className="mt-0.5 text-bad" />}
                <span className="text-muted">Cost ≤ ${ch.budget.maxCostPerHour}/h <span className="mono text-faint">(${(grade?.cost ?? cost).toFixed(3)})</span></span>
              </li>
            )}
          </ul>
          {status === "idle" && !grade && <p className="mt-1.5 text-[11px] text-faint">Run the scenario to see criteria tick live.</p>}
        </div>

        {violations.length > 0 && <p className="rounded bg-bad/10 px-2 py-1 text-bad">You changed locked items: {violations.join(", ")}. Revert them.</p>}
        {grade && !grading && (grade.pass && violations.length === 0
          ? <p className="rounded bg-ok/10 px-2 py-1 text-ok">All criteria met. Nice.</p>
          : <p className="rounded bg-warn/10 px-2 py-1 text-warn">Not yet — {grade.results.filter((r) => !r.pass).length + (grade.budgetOk ? 0 : 1)} criterion still failing.</p>)}

        {hintsShown > 0 && <ol className="space-y-1">{ch.hints.slice(0, hintsShown).map((h, i) => <li key={i} className="flex gap-1.5 text-muted"><Lightbulb size={12} className="mt-0.5 shrink-0 text-warn" />{h}</li>)}</ol>}
        {(done || (grade?.pass && violations.length === 0)) && (
          <div className="rounded-md bg-bg p-2"><div className="mb-0.5 text-[10.5px] font-medium uppercase tracking-wider text-faint">Trade-offs</div><p className="leading-snug text-muted">{active.writeup}</p>
            <button onClick={loadSolution} className="mt-1.5 text-info underline">Show reference solution</button></div>
        )}
      </div>}
      {!min && <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <button onClick={submit} disabled={grading} className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-accent-fg hover:brightness-110 disabled:opacity-60">{grading ? "Grading…" : "Check solution"}</button>
        <button onClick={showHint} disabled={hintsShown >= ch.hints.length} className="rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-muted hover:text-fg disabled:opacity-40">Hint {hintsShown}/{ch.hints.length}</button>
      </div>}
    </div>
  );
}

function LessonView({ id }: { id: string }) {
  const l = lessons[id]!;
  const [done, setDone] = useState<number[]>([]);
  return (
    <div className="rounded-lg border border-line bg-bg p-2.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-accent">Guided walkthrough</div>
      <p className="mt-1 text-fg">{l.objective}</p>
      <ol className="mt-2 space-y-2" aria-label="Steps">
        {l.steps.map((st, i) => (
          <li key={i} className="flex gap-2">
            <input type="checkbox" checked={done.includes(i)} onChange={() => setDone(done.includes(i) ? done.filter((x) => x !== i) : [...done, i])} aria-label={`Step ${i + 1} done`} className="mt-0.5" />
            <div><div className={`font-medium ${done.includes(i) ? "text-faint line-through" : ""}`}>{i + 1}. {st.title}</div><div className="leading-snug text-muted">{st.body}</div></div>
          </li>
        ))}
      </ol>
      <div className="mt-2.5 text-[10.5px] font-medium uppercase tracking-wider text-faint">Think about</div>
      <ul className="ml-3.5 list-disc text-muted">{l.reflect.map((r) => <li key={r}>{r}</li>)}</ul>
      <div className="mt-2.5 text-[10.5px] font-medium uppercase tracking-wider text-faint">Read more</div>
      <ul className="space-y-0.5">{l.refs.map((r) => <li key={r.url}><a href={r.url} target="_blank" rel="noopener noreferrer" className="text-info underline">{r.title}</a></li>)}</ul>
    </div>
  );
}
