import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, useReactFlow,
  type Connection, type Edge, type EdgeTypes, type Node, type NodeChange, type NodeTypes, type EdgeChange, applyNodeChanges,
} from "@xyflow/react";
import { useStore } from "../state/store";
import { registry } from "../lib/registry";
import { categoryColor } from "../lib/icons";
import { ComponentNode } from "./ComponentNode";
import { BoundaryNode } from "./BoundaryNode";
import { FlowEdge } from "./FlowEdge";
import { toast } from "../lib/toast";
import { EmptyCanvas } from "./EmptyCanvas";
import { setViewportCenter } from "../lib/viewport";

const nodeTypes: NodeTypes = { component: ComponentNode, boundary: BoundaryNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };
export const DND_MIME = "application/x-scaleforge-kind";

function Inner({ readOnly }: { readOnly?: boolean }) {
  const nodes = useStore((s) => s.doc.nodes);
  const edges = useStore((s) => s.doc.edges);
  const sel = useStore((s) => s.selection);
  const { moveNodes, select, connect, addNode, commit } = useStore.getState();
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setViewportCenter(() => {
      const r = wrap.current?.getBoundingClientRect();
      const p = rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 600) / 2, y: (r?.top ?? 0) + (r?.height ?? 400) / 2 });
      return { x: Math.round(p.x - 94), y: Math.round(p.y - 30) };
    });
  }, [rf]);
  const dragStart = useRef<{ boundaries: Record<string, { x: number; y: number; members: Record<string, { x: number; y: number }> }> } | null>(null);

  // RF keeps measured sizes; we mirror doc state into it and feed measurement/selection changes back.
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const cache = useRef(new WeakMap<object, { data: object }>());
  useEffect(() => {
    setRfNodes((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      return nodes.map((n) => {
        const old = byId.get(n.id);
        const selected = sel.nodes.includes(n.id);
        let c = cache.current.get(n);
        if (!c) { c = { data: n.kind === "boundary" ? { label: n.label } : { kind: n.kind, label: n.label, config: n.config } }; cache.current.set(n, c); }
        // keep RF-owned fields (measured, dragging, live resize) and only override what the doc owns
        return {
          ...old, id: n.id, type: n.kind === "boundary" ? "boundary" : "component", position: { x: n.x, y: n.y }, data: c.data,
          ...(n.kind === "boundary" ? { style: { width: old?.style?.width ?? n.w, height: old?.style?.height ?? n.h }, zIndex: -1 } : {}),
          ariaLabel: n.label ?? registry.get(n.kind)?.name ?? n.kind, selected,
        } as Node;
      });
    });
  }, [nodes, sel.nodes]);
  const rfEdges = useMemo<Edge[]>(() => edges.map((e) => ({
    id: e.id, source: e.from, sourceHandle: e.fromPort, target: e.to, targetHandle: e.toPort, type: "flow", data: { protocol: e.protocol },
    selected: sel.edges.includes(e.id), markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: registry.protocol(e.protocol)?.color },
  })), [edges, sel.edges]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const cur = useStore.getState().selection;
    let e = cur.edges;
    for (const c of changes) if (c.type === "select") e = c.selected ? [...new Set([...e, c.id])] : e.filter((x) => x !== c.id);
    if (e.join() !== cur.edges.join()) select(cur.nodes, e);
  }, [select]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((ns) => applyNodeChanges(changes, ns));
    const moves: Record<string, { x: number; y: number }> = {};
    const curSel = useStore.getState().selection;
    let selNodes = curSel.nodes;
    for (const c of changes) {
      if (c.type === "select") selNodes = c.selected ? [...new Set([...selNodes, c.id])] : selNodes.filter((x) => x !== c.id);
      if (c.type === "position" && c.position) moves[c.id] = c.position;
    }
    // carry nodes inside a dragged boundary along with it
    const ds = dragStart.current;
    if (ds) for (const [bid, b] of Object.entries(ds.boundaries)) {
      const to = moves[bid];
      if (to) for (const [mid, p] of Object.entries(b.members)) moves[mid] = { x: p.x + (to.x - b.x), y: p.y + (to.y - b.y) };
    }
    if (Object.keys(moves).length) moveNodes(moves);
    if (selNodes.join() !== curSel.nodes.join()) select(selNodes, curSel.edges);
  }, [moveNodes, select]);

  const onDragStart = useCallback((_: unknown, node: Node) => {
    commit();
    const all = useStore.getState().doc.nodes;
    const boundaries: NonNullable<typeof dragStart.current>["boundaries"] = {};
    for (const b of all.filter((n) => n.kind === "boundary" && (n.id === node.id || useStore.getState().selection.nodes.includes(n.id)))) {
      const members: Record<string, { x: number; y: number }> = {};
      for (const n of all) if (n.kind !== "boundary" && n.x + 94 >= b.x && n.x + 94 <= b.x + (b.w ?? 0) && n.y + 40 >= b.y && n.y + 40 <= b.y + (b.h ?? 0)) members[n.id] = { x: n.x, y: n.y };
      boundaries[b.id] = { x: b.x, y: b.y, members };
    }
    dragStart.current = { boundaries };
  }, [commit]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    const r = connect({ source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle });
    if (!r.ok) toast(r.reason ?? "Can't connect", "warn");
  }, [connect]);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const { doc } = useStore.getState();
    const a = doc.nodes.find((n) => n.id === c.source), b = doc.nodes.find((n) => n.id === c.target);
    if (!a || !b || a.id === b.id || !c.sourceHandle || !c.targetHandle) return false;
    const ad = registry.get(a.kind), bd = registry.get(b.kind);
    const out = ad?.ports.find((p) => p.id === c.sourceHandle), inn = bd?.ports.find((p) => p.id === c.targetHandle);
    return !!out && !!inn && out.protocols.some((p) => inn.protocols.includes(p));
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData(DND_MIME);
    if (!kind) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(kind, Math.round(p.x - 94), Math.round(p.y - 30));
  }, [rf, addNode]);

  return (
    <div ref={wrap} className="relative h-full w-full" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection}
        onNodeDragStart={onDragStart} onNodeDragStop={() => { dragStart.current = null; }}
        nodesDraggable={!readOnly} nodesConnectable={!readOnly} deleteKeyCode={null} multiSelectionKeyCode={["Meta", "Shift", "Control"]} selectionOnDrag panOnDrag={[1, 2]} selectionMode={SelectionMode.Partial}
        panOnScroll zoomOnScroll={false} zoomOnPinch minZoom={0.15} maxZoom={2.5} snapToGrid snapGrid={[8, 8]} fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: "flow" }} connectionRadius={28}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--line-strong)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === "boundary" ? "transparent" : categoryColor[registry.get((n.data as { kind: string }).kind)?.category ?? ""] ?? "#888")} maskColor="rgba(0,0,0,.45)" />
      </ReactFlow>
      {nodes.length === 0 && <EmptyCanvas />}
    </div>
  );
}

export const Canvas = ({ readOnly }: { readOnly?: boolean }) => <ReactFlowProvider><Inner readOnly={readOnly} /></ReactFlowProvider>;
