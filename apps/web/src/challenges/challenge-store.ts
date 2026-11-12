import { create } from "zustand";
import { gradeChallenge, lockViolations, type Grade } from "@scaleforge/engine";
import { registry } from "../lib/registry";
import { db } from "../lib/persistence";
import { engineDoc } from "../sim/sim-store";
import { useStore } from "../state/store";
import { catalog, type Loaded } from "./catalog";

interface CS {
  active: Loaded | null;
  passed: Record<string, number>;
  hintsShown: number;
  grade: Grade | null;
  violations: string[];
  grading: boolean;
  start(id: string): void;
  exit(): void;
  showHint(): void;
  submit(): Promise<void>;
  loadSolution(): void;
  hydrate(): Promise<void>;
}

export const useChallenge = create<CS>()((set, get) => ({
  active: null, passed: {}, hintsShown: 0, grade: null, violations: [], grading: false,
  start(id) {
    const c = catalog.find((x) => x.ch.id === id);
    if (!c) return;
    useStore.getState().load({ ...c.starter, id: `ch-${id}-${Date.now().toString(36)}` });
    useStore.setState((s) => { s.doc.scenario = c.ch.scenario; });
    useStore.getState().setLocks(c.ch.locked);
    set({ active: c, hintsShown: 0, grade: null, violations: [] });
  },
  exit: () => { useStore.getState().setLocks([]); set({ active: null, grade: null, violations: [] }); },
  showHint: () => set((s) => ({ hintsShown: Math.min(s.active?.ch.hints.length ?? 0, s.hintsShown + 1) })),
  async submit() {
    const a = get().active;
    if (!a) return;
    set({ grading: true });
    await new Promise((r) => setTimeout(r, 30)); // let the spinner paint; grading is a sync run of the real engine
    const doc = engineDoc();
    const starterDoc = { nodes: a.starter.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config })), edges: a.starter.edges };
    const violations = lockViolations(a.ch, starterDoc, doc);
    const grade = gradeChallenge(registry, a.ch, doc);
    const pass = grade.pass && violations.length === 0;
    if (pass) { const at = Date.now(); set((s) => ({ passed: { ...s.passed, [a.ch.id]: at } })); void db.progress.put({ id: a.ch.id, passedAt: at }).catch(() => {}); }
    set({ grade, violations, grading: false });
  },
  loadSolution() {
    const a = get().active;
    if (a) useStore.getState().load({ ...a.solution, id: `sol-${a.ch.id}` });
  },
  async hydrate() {
    try { const rows = await db.progress.toArray(); set({ passed: Object.fromEntries(rows.map((r) => [r.id, r.passedAt])) }); } catch { /* no IndexedDB */ }
  },
}));
