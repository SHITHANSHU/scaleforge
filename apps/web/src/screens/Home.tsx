import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useStore } from "../state/store";
import { deleteDesign, listDesigns } from "../lib/persistence";
import { loadTemplate, templates } from "../lib/templates";
import { defaultScenario, type Design } from "../state/types";
import { uid } from "../lib/format";
import type { Screen } from "../panels/TopBar";

const blurbs: Record<string, string> = {
  "cache-aside": "Client → LB → API fleet → Redis → Postgres. Ramp load and watch which tier saturates first.",
  "kafka-lag": "50k msg/s into 6 partitions with 8 consumers. Why does lag still grow?",
  "credit-cliff": "A t2.micro handles 90 rps — for a while. Find out how long.",
};

export function Home({ go }: { go(s: Screen): void }) {
  const [saved, setSaved] = useState<Design[]>([]);
  const load = useStore((s) => s.load);
  const refresh = () => void listDesigns().then(setSaved).catch(() => setSaved([]));
  useEffect(refresh, []);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-[22px] font-semibold tracking-tight">Design it. Load it. Watch it break.</h1>
        <p className="mt-1.5 max-w-xl text-muted">A browser-only lab for backend architecture. Drop components on a canvas, drive traffic through them, inject failures — every number is visible and editable.</p>
        <button onClick={() => { load({ id: uid("d"), name: "Untitled design", nodes: [], edges: [], scenario: defaultScenario() }); go("workspace"); }} className="mt-5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-fg hover:brightness-110">New blank design</button>

        <h2 className="mb-2 mt-10 text-[11px] font-medium uppercase tracking-wider text-faint">Start from a template</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {templates.map((t) => (
            <button key={t.id} onClick={() => { load(loadTemplate(t.id)); go("workspace"); }} className="rounded-lg border border-line bg-surface p-3.5 text-left hover:border-accent">
              <div className="text-[13px] font-medium">{t.title}</div><div className="mt-1 text-[11.5px] leading-snug text-muted">{blurbs[t.id]}</div>
            </button>
          ))}
        </div>

        <h2 className="mb-2 mt-10 text-[11px] font-medium uppercase tracking-wider text-faint">Recent designs</h2>
        {saved.length === 0 ? <p className="text-[12.5px] text-faint">Nothing saved yet. Designs autosave to this browser.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {saved.slice(0, 12).map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <button onClick={() => { load(d, { fromDb: true }); go("workspace"); }} className="min-w-0 flex-1 text-left"><div className="truncate text-[13px]">{d.name}</div><div className="text-[11px] text-faint">{d.nodes.length} nodes · {new Date(d.updatedAt).toLocaleString()}</div></button>
                <button aria-label={`Delete ${d.name}`} onClick={async () => { await deleteDesign(d.id); refresh(); }} className="rounded p-1.5 text-faint hover:bg-hover hover:text-bad"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
