import { useEffect, useRef } from "react";
import uPlot from "uplot";

export interface Line { label: string; color: string; values: (number | null)[]; dash?: number[] }

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";

export function Chart({ title, unit, xs, lines, height = 120, percent }: { title: string; unit?: string; xs: number[]; lines: Line[]; height?: number; percent?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const sig = lines.map((l) => l.label + l.color).join("|") + (percent ? "%" : "");

  useEffect(() => {
    const host = el.current!;
    const muted = cssVar("--faint"), grid = cssVar("--line");
    const u = new uPlot({
      width: host.clientWidth || 300, height,
      padding: [6, 6, 0, 0], legend: { show: false }, cursor: { show: true, points: { size: 5 } },
      scales: { x: { time: false }, y: { range: (_u, _min, max) => [0, percent ? Math.max(1, max) : Math.max(1, max * 1.1)] } },
      axes: [
        { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { show: false }, font: "10px JetBrains Mono", size: 22, values: (_u, v) => v.map((x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`) },
        { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { show: false }, font: "10px JetBrains Mono", size: 44, values: (_u, v) => v.map((x) => (percent ? `${Math.round(x * 100)}%` : x >= 1000 ? `${+(x / 1000).toFixed(1)}k` : String(+x.toFixed(x < 10 ? 1 : 0)))) },
      ],
      series: [{}, ...lines.map((l) => ({ label: l.label, stroke: l.color, width: 1.5, dash: l.dash, points: { show: false } }))],
    }, [xs, ...lines.map((l) => l.values)] as uPlot.AlignedData, host);
    plot.current = u;
    const ro = new ResizeObserver(() => u.setSize({ width: host.clientWidth, height }));
    ro.observe(host);
    return () => { ro.disconnect(); u.destroy(); plot.current = null; };
  }, [sig, height]);

  useEffect(() => { plot.current?.setData([xs, ...lines.map((l) => l.values)] as uPlot.AlignedData); }, [xs, lines]);

  return (
    <figure className="min-w-0">
      <figcaption className="mb-0.5 flex items-center gap-3 text-[11px]">
        <span className="font-medium text-muted">{title}{unit ? <span className="text-faint"> · {unit}</span> : null}</span>
        <span className="ml-auto flex gap-2.5">{lines.map((l) => <span key={l.label} className="flex items-center gap-1 text-faint"><i className="inline-block h-0.5 w-3 rounded" style={{ background: l.color }} />{l.label}</span>)}</span>
      </figcaption>
      <div ref={el} role="img" aria-label={`${title} chart`} />
    </figure>
  );
}
