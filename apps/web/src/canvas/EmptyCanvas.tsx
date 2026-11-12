import { useStore } from "../state/store";
import { loadTemplate, templates } from "../lib/templates";

export function EmptyCanvas() {
  const load = useStore((s) => s.load);
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto max-w-md text-center">
        <h2 className="text-[15px] font-medium">Design an architecture, then break it</h2>
        <p className="mt-1 text-muted">Drag components from the left, or double-click the canvas… or start from a template.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => load(loadTemplate(t.id))} className="rounded-md border border-line-strong bg-raised px-3 py-1.5 text-[12px] hover:border-accent hover:text-accent">{t.title}</button>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-faint">Tip: <kbd className="mono rounded bg-raised px-1">⌘K</kbd> opens quick-add · <kbd className="mono rounded bg-raised px-1">Space</kbd> runs</p>
      </div>
    </div>
  );
}
