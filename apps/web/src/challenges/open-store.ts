import { create } from "zustand";
import type { OpenChallenge, OpenGrade } from "@scaleforge/engine";
import { db } from "../lib/persistence";
import { engineDoc, gradeInWorker } from "../sim/sim-store";
import { useStore } from "../state/store";
import { defaultScenario, type DocNode } from "../state/types";
import { loadGrading, loadReference, loadWriteup, openCatalog } from "./open-catalog";

export interface Solved { at: number; score: number }
interface OS {
  active: OpenChallenge | null;
  scenarioId: string;
  hints: number;
  result: OpenGrade | null;
  evaluating: boolean;
  error: string | null;
  revealed: { writeup: string } | null;
  solved: Record<string, Solved>;
  attempts: Record<string, number>;
  start(id: string): void;
  exit(): void;
  pickScenario(id: string): void;
  hint(): void;
  evaluate(): Promise<void>;
  reveal(): Promise<void>;
  loadReference(): Promise<void>;
  hydrate(): Promise<void>;
}

/** Build the starting canvas: only what the scenario fixes (traffic sources, regions, legacy systems). */
function startingNodes(ch: OpenChallenge): DocNode[] {
  return ch.resources.fixed.map((f) => ({ id: f.id, kind: f.kind, label: f.label, config: f.kind === "boundary" ? {} : { ...(f.config ?? {}) }, x: f.x, y: f.y, w: f.w, h: f.h }));
}

export const useOpen = create<OS>()((set, get) => ({
  active: null, scenarioId: "", hints: 0, result: null, evaluating: false, error: null, revealed: null, solved: {}, attempts: {},

  start(id) {
    const ch = openCatalog.find((c) => c.id === id);
    if (!ch) return;
    const st = useStore.getState();
    st.load({ id: `oc-${id}-${Date.now().toString(36)}`, name: ch.title, nodes: startingNodes(ch), edges: [...(ch.resources.fixedEdges ?? [])], scenario: ch.scenarios[0]?.scenario ?? defaultScenario() });
    const locks: string[] = [];
    for (const f of ch.resources.fixed) {
      if (f.locked === true || f.kind === "boundary") locks.push(f.id);
      else if (Array.isArray(f.locked)) for (const k of f.locked) locks.push(`${f.id}.${k}`);
    }
    st.setLocks(locks);
    st.setRules({ allowed: ch.resources.allowed, maxNodes: ch.resources.maxNodes, kindDefaults: ch.resources.kindDefaults ?? {}, kindLocked: ch.resources.kindLocked ?? {}, fixedIds: ch.resources.fixed.map((f) => f.id) });
    set({ active: ch, scenarioId: ch.scenarios[0]?.id ?? "", hints: 0, result: null, error: null, revealed: null });
  },
  exit() { const st = useStore.getState(); st.setLocks([]); st.setRules(null); set({ active: null, result: null, revealed: null, error: null }); },
  pickScenario(id) {
    const ch = get().active; const sc = ch?.scenarios.find((s) => s.id === id);
    if (!sc) return;
    useStore.setState((s) => { s.doc.scenario = JSON.parse(JSON.stringify(sc.scenario)); s.structureRev++; });
    set({ scenarioId: id });
  },
  hint: () => set((s) => ({ hints: Math.min(s.active?.hints?.length ?? 0, s.hints + 1) })),

  async evaluate() {
    const ch = get().active;
    if (!ch) return;
    set({ evaluating: true, error: null });
    try {
      const grading = await loadGrading(ch.id);
      const result = await gradeInWorker(ch, grading, engineDoc());
      set((s) => ({ result, evaluating: false, attempts: { ...s.attempts, [ch.id]: (s.attempts[ch.id] ?? 0) + 1 } }));
      if (result.pass) {
        const prev = get().solved[ch.id];
        const rec = { at: Date.now(), score: Math.max(prev?.score ?? 0, result.score) };
        set((s) => ({ solved: { ...s.solved, [ch.id]: rec } }));
        void db.progress.put({ id: `open:${ch.id}`, passedAt: rec.at, score: rec.score } as never).catch(() => {});
      }
    } catch (e) { set({ evaluating: false, error: (e as Error).message }); }
  },
  async reveal() { const ch = get().active; if (ch) set({ revealed: { writeup: await loadWriteup(ch.id) } }); },
  async loadReference() {
    const ch = get().active; if (!ch) return;
    const d = await loadReference(ch.id);
    useStore.getState().load({ ...d, id: `oc-${ch.id}-reference-${Date.now().toString(36)}` });
    useStore.getState().setLocks([]); useStore.getState().setRules(null);
  },
  async hydrate() {
    try {
      const rows = await db.progress.toArray();
      set({ solved: Object.fromEntries(rows.filter((r) => String(r.id).startsWith("open:")).map((r) => [String(r.id).slice(5), { at: r.passedAt, score: (r as { score?: number }).score ?? 0 }])) });
    } catch { /* no IndexedDB */ }
  },
}));
