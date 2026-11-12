import { useMemo, useState } from "react";
import { Search, Square } from "lucide-react";
import { useRegistry } from "../lib/registry";
import { Icon, categoryColor, categoryLabel } from "../lib/icons";
import { useStore } from "../state/store";
import { getViewportCenter } from "../lib/viewport";
import { DND_MIME } from "../canvas/Canvas";
import * as Tooltip from "@radix-ui/react-tooltip";

const ORDER = ["traffic", "network", "compute", "cache", "messaging", "data"];

export function Palette() {
  const reg = useRegistry();
  const [q, setQ] = useState("");
  const addNode = useStore((s) => s.addNode);
  const allowed = useStore((s) => s.rules?.allowed);
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const items = reg.list().filter((d) => (!allowed || allowed.includes(d.kind)) && (!term || `${d.name} ${d.description} ${d.kind} ${d.category}`.toLowerCase().includes(term)));
    return ORDER.map((c) => ({ c, items: items.filter((d) => d.category === c) })).filter((g) => g.items.length);
  }, [reg, q, allowed]);
  const add = (kind: string) => { const p = getViewportCenter(); addNode(kind, p.x + Math.round(Math.random() * 40), p.y + Math.round(Math.random() * 40)); };

  return (
    <aside aria-label="Component palette" className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="p-2.5">
        <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-2 focus-within:border-accent">
          <Search size={13} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search components" aria-label="Search components" id="palette-search"
            className="w-full bg-transparent py-1.5 text-[12px] outline-none placeholder:text-faint" />
          <kbd className="mono text-[10px] text-faint">/</kbd>
        </div>
      </div>
      <Tooltip.Provider delayDuration={350}>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((g) => (
            <section key={g.c} className="mb-2">
              <h3 className="px-1.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wider text-faint">{categoryLabel[g.c]}</h3>
              {g.items.map((d) => (
                <Tooltip.Root key={d.kind}>
                  <Tooltip.Trigger asChild>
                    <button draggable onDragStart={(e) => { e.dataTransfer.setData(DND_MIME, d.kind); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => add(d.kind)}
                      className="group flex w-full cursor-grab items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-hover active:cursor-grabbing">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ background: `${categoryColor[d.category]}22`, color: categoryColor[d.category] }}><Icon name={d.icon} size={14} /></span>
                      <span className="min-w-0"><span className="block truncate text-[12.5px]">{d.name}</span></span>
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content side="right" sideOffset={8} className="z-50 max-w-[240px] rounded-md border border-line-strong bg-raised px-2.5 py-2 text-[11.5px] leading-snug shadow-xl">
                      <div className="font-medium">{d.name}</div><div className="text-muted">{d.description}</div>
                      <div className="mt-1 text-faint">Drag onto canvas or click to add</div>
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              ))}
            </section>
          ))}
          {(!allowed || allowed.length > 0) && (!q || "boundary vpc region zone".includes(q.toLowerCase())) && (
            <section>
              <h3 className="px-1.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wider text-faint">Structure</h3>
              <button draggable onDragStart={(e) => { e.dataTransfer.setData(DND_MIME, "boundary"); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => add("boundary")}
                className="flex w-full cursor-grab items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-hover">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-line text-muted"><Square size={13} strokeDasharray="3 2" /></span>
                <span className="text-[12.5px]">Boundary <span className="text-faint">VPC / AZ</span></span>
              </button>
            </section>
          )}
          {groups.length === 0 && q && <p className="px-2 py-4 text-center text-[12px] text-faint">No component matches “{q}”.</p>}
        </div>
      </Tooltip.Provider>
    </aside>
  );
}
