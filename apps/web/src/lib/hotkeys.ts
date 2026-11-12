import { useEffect } from "react";
import { useStore } from "../state/store";
import { useSim } from "../sim/sim-store";

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
/** Controls that own Space/Enter/Delete natively; global shortcuts must not steal them. */
const widget = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('button, a, summary, [role="radio"], [role="switch"], [role="slider"], [role="tab"], [role="option"], [role="dialog"]');

export function useHotkeys(h: { quickAdd(): void; help(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const s = useStore.getState();
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); h.quickAdd(); return; }
      if (typing(e.target) || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); }
      else if (mod && k === "y") { e.preventDefault(); s.redo(); }
      else if (mod && k === "c") { s.copy(); }
      else if (mod && k === "v") { e.preventDefault(); s.paste(); }
      else if (mod && k === "d") { e.preventDefault(); s.duplicate(); }
      else if (mod && k === "g") { e.preventDefault(); s.groupSelection(); }
      else if (mod && k === "a") { e.preventDefault(); s.select(s.doc.nodes.map((n) => n.id), []); }
      else if ((k === "delete" || k === "backspace") && !widget(e.target)) { e.preventDefault(); s.deleteSelection(); }
      else if (k === " " && !widget(e.target)) { e.preventDefault(); const sim = useSim.getState(); sim.status === "running" ? sim.pause() : sim.run(); }
      else if (k === ".") useSim.getState().step();
      else if (k === "escape") s.select([], []);
      else if (k === "/") { e.preventDefault(); document.getElementById("palette-search")?.focus(); }
      else if (k === "?") h.help();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [h]);
}
