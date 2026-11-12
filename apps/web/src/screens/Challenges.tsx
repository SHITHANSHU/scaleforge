import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Clock, Search } from "lucide-react";
import { catalog as guided } from "../challenges/catalog";
import { useChallenge } from "../challenges/challenge-store";
import { categories, LEVELS, openCatalog } from "../challenges/open-catalog";
import { useOpen } from "../challenges/open-store";
import type { Screen } from "../panels/TopBar";

const levelTone: Record<string, string> = { intermediate: "text-info", advanced: "text-ok", senior: "text-warn", staff: "text-bad", mid: "text-info" };
type Mode = "open" | "guided";

export function Challenges({ go }: { go(s: Screen): void }) {
  const [mode, setMode] = useState<Mode>("open");
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-[20px] font-semibold tracking-tight">Challenges</h1>
        <div role="tablist" aria-label="Challenge type" className="mt-4 flex gap-1 border-b border-line">
          {([["open", "Engineering challenges"], ["guided", "Guided exercises"]] as [Mode, string][]).map(([m, l]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] ${mode === m ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>{l}</button>
          ))}
        </div>
        {mode === "open" ? <Open go={go} /> : <Guided go={go} />}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return <button onClick={onClick} aria-pressed={active} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${active ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:text-fg"}`}>{children}</button>;
}

function Open({ go }: { go(s: Screen): void }) {
  const { start, solved, hydrate } = useOpen();
  const [q, setQ] = useState(""), [cats, setCats] = useState<string[]>([]), [lvls, setLvls] = useState<string[]>([]), [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void hydrate(); }, [hydrate]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return openCatalog.filter((c) => (!t || `${c.title} ${c.summary} ${c.tags.join(" ")} ${c.category} ${c.statement.situation}`.toLowerCase().includes(t)) && (cats.length === 0 || cats.includes(c.category)) && (lvls.length === 0 || lvls.includes(c.level)));
  }, [q, cats, lvls]);
  const solvedN = openCatalog.filter((c) => solved[c.id]).length;

  return (
    <>
      <p className="mt-4 max-w-2xl text-muted">Realistic production situations. You get a problem statement, constraints and a blank canvas — what to build is up to you. Your design is judged by simulation, including scenarios you haven’t seen. {solvedN}/{openCatalog.length} solved.</p>
      <div className="mt-5 flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent">
        <Search size={14} className="text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by problem, symptom or topic" aria-label="Search challenges" className="w-full bg-transparent py-2 text-[13px] outline-none placeholder:text-faint" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
        {LEVELS.map((l) => <Chip key={l} active={lvls.includes(l)} onClick={() => toggle(lvls, setLvls, l)}>{l}</Chip>)}
        <span className="mx-1 h-4 w-px bg-line" />
        {categories.map((c) => <Chip key={c} active={cats.includes(c)} onClick={() => toggle(cats, setCats, c)}>{c}</Chip>)}
      </div>
      <ul className="mt-5 divide-y divide-line rounded-lg border border-line" aria-label="Engineering challenges">
        {items.map((c) => {
          const s = solved[c.id], expanded = open === c.id;
          return (
            <li key={c.id}>
              <button onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded} className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-hover">
                <ChevronRight size={14} className={`mt-1 shrink-0 text-faint transition-transform ${expanded ? "rotate-90" : ""}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">{c.title}</span>
                  <span className="block text-[12px] text-muted">{c.summary}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`font-medium uppercase tracking-wider ${levelTone[c.level]}`}>{c.level}</span>
                    <span className="text-faint">{c.category}</span>
                    <span className="flex items-center gap-1 text-faint"><Clock size={11} /> ~{c.estimatedMinutes} min</span>
                    {c.resources.budget && <span className="text-faint">budget ${c.resources.budget.maxCostPerHour}/h</span>}
                  </span>
                </span>
                {s && <span className="flex items-center gap-1 text-[11.5px] text-ok"><Check size={13} /> {Math.round(s.score)}</span>}
              </button>
              {expanded && (
                <div className="space-y-3 border-t border-line bg-surface px-11 py-4 text-[12.5px]">
                  <p className="leading-snug">{c.statement.situation}</p>
                  <div><h4 className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-faint">Requirements</h4><ul className="ml-4 list-disc text-muted">{c.statement.requirements.map((r) => <li key={r}>{r}</li>)}</ul></div>
                  <div><h4 className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-faint">Constraints</h4><ul className="ml-4 list-disc text-muted">{c.statement.constraints.map((r) => <li key={r}>{r}</li>)}</ul></div>
                  <div className="flex flex-wrap gap-1">{c.tags.map((t) => <span key={t} className="rounded bg-bg px-1.5 py-0.5 text-[10.5px] text-faint">{t}</span>)}</div>
                  <button onClick={() => { start(c.id); go("workspace"); }} className="rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-fg hover:brightness-110">Start on a blank canvas</button>
                </div>
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="px-4 py-8 text-center text-faint">No challenge matches those filters.</li>}
      </ul>
    </>
  );
}

function Guided({ go }: { go(s: Screen): void }) {
  const { start, passed, hydrate } = useChallenge();
  useEffect(() => { void hydrate(); }, [hydrate]);
  return (
    <>
      <p className="mt-4 max-w-2xl text-muted">Focused exercises on one technology, starting from a broken design. Good for learning a single idea; the engineering challenges are where you decide the architecture yourself. {Object.keys(passed).length}/{guided.length} solved.</p>
      <ul className="mt-5 divide-y divide-line rounded-lg border border-line" aria-label="Guided exercises">
        {guided.map(({ ch }) => (
          <li key={ch.id}>
            <button onClick={() => { start(ch.id); go("workspace"); }} className="flex w-full items-start gap-4 px-4 py-3.5 text-left hover:bg-hover">
              <span className={`mt-0.5 w-14 shrink-0 text-[10.5px] font-medium uppercase tracking-wider ${levelTone[ch.level]}`}>{ch.level}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">{ch.title}</span>
                <span className="block text-[12px] text-muted">{ch.summary}</span>
                <span className="mt-1 flex flex-wrap gap-1.5">{ch.tags.map((t) => <span key={t} className="rounded bg-bg px-1.5 py-0.5 text-[10.5px] text-faint">{t}</span>)}</span>
              </span>
              {passed[ch.id] && <span className="flex items-center gap-1 text-[11.5px] text-ok"><Check size={13} /> Solved</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
