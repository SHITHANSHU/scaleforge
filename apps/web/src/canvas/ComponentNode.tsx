import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { registry } from "../lib/registry";
import { Icon, categoryColor } from "../lib/icons";
import { fmt, utilColor } from "../lib/format";
import { useSim } from "../sim/sim-store";
import { useLint } from "../lib/lint";

export interface CNodeData { kind: string; label?: string; config: Record<string, number | string | boolean> }

export const ComponentNode = memo(function ComponentNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as CNodeData;
  const def = registry.get(d.kind);
  const m = useSim(useShallow((s) => s.latest?.nodes[id]));
  const down = useSim((s) => s.latest?.down.includes(id) ?? false);
  const running = useSim((s) => s.status !== "idle");
  const issues = useLint((s) => s.byNode[id]);
  if (!def) return <div className="rounded-md border border-bad bg-raised px-3 py-2 text-bad">Unknown: {d.kind}</div>;

  const color = categoryColor[def.category] ?? "#888";
  const util = m?.utilization ?? 0;
  const ins = def.ports.filter((p) => p.direction === "in" && !p.hidden);
  const outs = def.ports.filter((p) => p.direction === "out" && !p.hidden);
  const stats = running && m ? def.metrics.filter((x) => x.id !== "utilization" && x.id !== "queueDepth").slice(0, 2) : [];
  const queue = m?.queueDepth ?? 0;
  const limit = Number(d.config.queueLimit ?? 0);
  const saturated = running && util >= 0.95 && !down;

  return (
    <div
      className={`relative w-[188px] rounded-lg border bg-raised transition-shadow ${selected ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line-strong"} ${saturated ? "pulse-bad" : ""} ${down ? "opacity-60" : ""}`}
      style={running && !down ? { borderColor: selected ? undefined : util > 0.02 ? utilColor(util) : undefined } : undefined}
    >
      {ins.map((p, i) => (
        <Handle key={p.id} id={p.id} type="target" position={Position.Left} style={{ top: `${((i + 1) * 100) / (ins.length + 1)}%`, background: registry.protocol(p.protocols[0]!)?.color }} title={`${p.label}: ${p.protocols.join(", ")}`} />
      ))}
      {outs.map((p, i) => (
        <Handle key={p.id} id={p.id} type="source" position={Position.Right} style={{ top: `${((i + 1) * 100) / (outs.length + 1)}%`, background: registry.protocol(p.protocols[0]!)?.color }} title={`${p.label}: ${p.protocols.join(", ")}`} />
      ))}
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ background: `${color}22`, color }}><Icon name={def.icon} size={14} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium leading-tight">{d.label ?? def.name}</div>
          <div className="truncate text-[10.5px] text-faint">{summary(d.kind, d.config)}</div>
        </div>
        {!running && issues && issues.some((i) => i.severity !== "info") && (
          <span role="img" aria-label={issues.map((i) => i.message).join("; ")} title={issues.map((i) => i.message).join("\n")} className={`h-2 w-2 rounded-full ${issues.some((i) => i.severity === "error") ? "bg-bad" : "bg-warn"}`} />
        )}
        {down && <span className="rounded bg-bad/20 px-1 text-[10px] font-medium text-bad">DOWN</span>}
      </div>
      <div className="px-2.5 pb-2 pt-1.5">
        {running ? (
          <>
            <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Utilization" aria-valuenow={Math.round(util * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.min(100, util * 100)}%`, background: utilColor(util) }} />
            </div>
            <div className="mono mt-1 flex items-center justify-between gap-1 whitespace-nowrap text-[10.5px] text-muted">
              <span style={{ color: utilColor(util) }}>{Math.round(util * 100)}%{util >= 0.95 ? " saturated" : util >= 0.75 ? " high" : ""}</span>
              {stats.map((s) => <span key={s.id} title={s.label}>{short(s.label)} {fmt(m?.[s.id] ?? 0, s.unit === "%" ? "%" : "")}</span>)}
            </div>
            {queue > 0.5 && (
              <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-warn" title="Queue depth">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full bg-warn" style={{ width: `${limit > 0 ? Math.min(100, (queue / limit) * 100) : 60}%` }} /></div>
                <span className="mono">q {fmt(queue)}</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-[10.5px] text-faint">{def.ports.filter((p) => !p.hidden).map((p) => p.label).join(" · ")}</div>
        )}
      </div>
    </div>
  );
});

const short = (l: string) => l.replace("Consumer lag (total)", "lag").replace("Ready messages", "ready").replace("Open connections", "conns").replace("FP rate (theory)", "fp").replace("CDC lag", "lag").replace("Origin offload", "offload").replace("Limit used", "used").replace("Consumer lag (max partition)", "max lag").replace("Hit ratio", "hit").replace("Memory used", "mem").replace("Memory", "mem").replace("CPU credits / instance", "credits").replace("Connections in use", "conns").replace("Connections", "conns").replace("Replica lag", "repl").replace("CPU", "cpu").replace("Evictions", "evict");

function summary(kind: string, c: Record<string, number | string | boolean>): string {
  switch (kind) {
    case "ec2": return `${c.count}× ${c.vcpu} vCPU · ${c.memoryGiB} GiB`;
    case "redis": return `${c.memoryMB} MB · ${c.evictionPolicy}`;
    case "kafka": return `${c.partitions}p · ${c.consumers} consumers`;
    case "postgres": return `${c.maxConnections} conns · ${c.readReplicas} replicas`;
    case "load-balancer": return String(c.algorithm);
    case "client": return `${c.share}% of load`;
    default: return "";
  }
}
