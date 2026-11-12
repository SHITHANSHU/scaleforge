import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useStore } from "../state/store";

export const BoundaryNode = memo(function BoundaryNode({ id, data, selected }: NodeProps) {
  const label = (data as { label?: string }).label ?? "Boundary";
  const setLabel = useStore((s) => s.setLabel);
  const resize = useStore((s) => s.resizeNode);
  const [edit, setEdit] = useState(false);
  return (
    <div className={`h-full w-full rounded-xl border border-dashed ${selected ? "border-accent" : "border-line-strong"} bg-white/[0.015]`}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} lineClassName="!border-accent" handleClassName="!h-2 !w-2 !rounded-sm !border-accent !bg-bg"
        onResizeStart={() => useStore.getState().commit()} onResizeEnd={(_, p) => resize(id, p.width, p.height)} />
      {edit ? (
        <input autoFocus defaultValue={label} className="m-1.5 w-44 rounded bg-raised px-1.5 py-0.5 text-[11px] uppercase tracking-wider outline-none"
          onBlur={(e) => { setLabel(id, e.target.value || "Boundary"); setEdit(false); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
      ) : (
        <div onDoubleClick={() => setEdit(true)} className="select-none px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wider text-faint" title="Double-click to rename (VPC, region, AZ…)">{label}</div>
      )}
    </div>
  );
});
