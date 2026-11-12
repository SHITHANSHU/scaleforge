import { create } from "zustand";
import { validateGraph, type Issue } from "@scaleforge/engine";
import { registry } from "./registry";
import { useStore } from "../state/store";
import { engineDoc } from "../sim/sim-store";

interface Lint { issues: Issue[]; byNode: Record<string, Issue[]> }
export const useLint = create<Lint>(() => ({ issues: [], byNode: {} }));

let t: ReturnType<typeof setTimeout> | undefined;
function recompute() {
  const issues = validateGraph(engineDoc(), registry);
  const byNode: Record<string, Issue[]> = {};
  for (const i of issues) if (i.nodeId) (byNode[i.nodeId] ??= []).push(i);
  useLint.setState({ issues, byNode });
}
useStore.subscribe((s, p) => { if (s.doc.nodes !== p.doc.nodes || s.doc.edges !== p.doc.edges) { clearTimeout(t); t = setTimeout(recompute, 120); } });
registry.subscribe(() => recompute());
recompute();
