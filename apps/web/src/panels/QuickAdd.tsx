import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRegistry } from "../lib/registry";
import { Icon } from "../lib/icons";
import { useStore } from "../state/store";
import { getViewportCenter } from "../lib/viewport";

/** Modal combobox: Radix Dialog gives the focus trap, Escape, restore-focus and aria-modal. */
export function QuickAdd({ open, onClose }: { open: boolean; onClose(): void }) {
  const reg = useRegistry();
  const [q, setQ] = useState(""), [i, setI] = useState(0);
  const items = useMemo(() => reg.list().filter((d) => `${d.name} ${d.kind} ${d.category}`.toLowerCase().includes(q.toLowerCase())), [reg, q]);
  useEffect(() => { if (open) { setQ(""); setI(0); } }, [open]);
  const pick = (kind: string) => { const p = getViewportCenter(); useStore.getState().addNode(kind, p.x, p.y); onClose(); };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-[18vh] z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-2xl">
          <Dialog.Title className="sr-only">Quick add component</Dialog.Title>
          <input
            role="combobox" aria-expanded="true" aria-controls="qa-list" aria-activedescendant={items[i] ? `qa-${items[i]!.kind}` : undefined} aria-autocomplete="list"
            value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="Add component…" aria-label="Component name"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((i + 1) % Math.max(1, items.length)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((i - 1 + items.length) % Math.max(1, items.length)); }
              else if (e.key === "Enter" && items[i]) pick(items[i]!.kind);
            }}
            className="w-full border-b border-line bg-transparent px-3.5 py-3 text-[14px]" />
          <div className="sr-only" role="status" aria-live="polite">{items.length} results</div>
          <ul id="qa-list" role="listbox" aria-label="Components" className="max-h-72 overflow-y-auto p-1.5">
            {items.map((d, k) => (
              <li key={d.kind} id={`qa-${d.kind}`} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => pick(d.kind)} className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 ${k === i ? "bg-accent-soft" : ""}`}>
                <Icon name={d.icon} size={15} /><span className="text-[13px]">{d.name}</span><span className="ml-auto text-[11px] text-faint">{d.category}</span>
              </li>
            ))}
            {items.length === 0 && <li className="px-3 py-4 text-center text-faint">Nothing found</li>}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
