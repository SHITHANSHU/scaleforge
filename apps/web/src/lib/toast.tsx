import { create } from "zustand";

interface T { id: number; msg: string; tone: "info" | "warn" | "ok" }
export const useToasts = create<{ list: T[] }>(() => ({ list: [] }));
let n = 0;
export function toast(msg: string, tone: T["tone"] = "info") {
  const id = ++n;
  useToasts.setState((s) => ({ list: [...s.list, { id, msg, tone }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), 3200);
}
export function Toasts() {
  const list = useToasts((s) => s.list);
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`pointer-events-auto rounded-md border bg-raised px-3 py-1.5 text-[12px] shadow-lg ${t.tone === "warn" ? "border-warn/50 text-warn" : t.tone === "ok" ? "border-ok/50 text-ok" : "border-line-strong"}`}>{t.msg}</div>
      ))}
    </div>
  );
}
