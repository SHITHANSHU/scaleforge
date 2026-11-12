import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { registry } from "../lib/registry";
import { fmt, fmtMs } from "../lib/format";
import { useSim } from "../sim/sim-store";

export const FlowEdge = memo(function FlowEdge(p: EdgeProps) {
  const protocol = (p.data as { protocol?: string } | undefined)?.protocol ?? "http";
  const color = registry.protocol(protocol)?.color ?? "#888";
  const live = useSim(useShallow((s) => s.latest?.edges[p.id]));
  const [path, lx, ly] = getBezierPath(p);
  const rps = live?.rps ?? 0;
  const active = rps > 0.5;
  const width = active ? 1.5 + Math.min(4, Math.log10(rps + 1) * 0.9) : 1.5;
  const speed = active ? Math.max(0.25, 1.6 - Math.log10(rps + 1) * 0.3) : 0;

  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} interactionWidth={18}
        style={{ stroke: color, strokeWidth: p.selected ? width + 1.5 : width, opacity: active || !useSim.getState().latest ? 0.85 : 0.35 }} />
      {active && (
        <path d={path} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={width * 0.6} strokeDasharray="2 22" strokeLinecap="round"
          className="edge-flow pointer-events-none" style={{ animationDuration: `${speed}s` }} />
      )}
      {(active || p.selected) && (
        <EdgeLabelRenderer>
          <div className="mono pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-bg/90 px-1.5 py-0.5 text-[10px] text-muted"
            style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}>
            {active ? `${fmt(rps)}/s · ${fmtMs(live!.latencyMs)}` : registry.protocol(protocol)?.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
