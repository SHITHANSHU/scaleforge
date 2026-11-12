export function fmt(n: number, unit = ""): string {
  if (!Number.isFinite(n)) return "–";
  if (unit === "%") return `${(n * 100).toFixed(n >= 0.995 || n === 0 ? 0 : 1)}%`;
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : a >= 100 ? n.toFixed(0) : a >= 10 ? n.toFixed(1) : n.toFixed(2);
  return unit && unit !== "%" ? `${s} ${unit}` : s;
}
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`);
export const fmtTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
export const uid = (p = "n") => `${p}_${Math.random().toString(36).slice(2, 8)}`;
export const utilColor = (u: number) => (u >= 0.95 ? "var(--bad)" : u >= 0.75 ? "var(--warn)" : u > 0.02 ? "var(--ok)" : "var(--faint)");
