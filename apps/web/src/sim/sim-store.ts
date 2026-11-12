import { create } from "zustand";
import * as Comlink from "comlink";
import type { Grading, GraphDoc, OpenChallenge, OpenGrade, SimEvent, Snapshot } from "@scaleforge/engine";
import { useStore } from "../state/store";

type Host = Comlink.Remote<{
  onSnapshot(cb: (s: Snapshot, done: boolean) => void): void;
  load(doc: GraphDoc, scenario: unknown): void;
  setConfigs(c: Record<string, Record<string, number | string | boolean>>): void;
  setSpeed(x: number): void;
  play(): void; pause(): void; step(sec?: number): void;
  grade(ch: OpenChallenge, grading: Grading, doc: GraphDoc): OpenGrade;
}>;

export type RunStatus = "idle" | "running" | "paused" | "done";
export interface Sat { peak: number; firstAt?: number }
const MAX_HISTORY = 4000;

interface SimStore {
  status: RunStatus;
  speed: number;
  time: number;
  latest: Snapshot | null;
  history: Snapshot[];
  events: SimEvent[];
  saturation: Record<string, Sat>;
  /** Auto-selected design problem, if the graph can't run. */
  error: string | null;
  run(): Promise<void>;
  pause(): void;
  step(): void;
  stop(): void;
  setSpeed(x: number): void;
  syncConfigs(): void;
}

let host: Host | null = null;
let loadedRev = -1;
const getHost = (): Host => {
  if (!host) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    host = Comlink.wrap(worker) as unknown as Host;
    host.onSnapshot(Comlink.proxy((snap: Snapshot, done: boolean) => useSim.getState().ingest(snap, done)) as never);
  }
  return host;
};

/** Strip UI-only nodes and positions before handing the graph to the engine. */
export function engineDoc(): GraphDoc {
  const { doc } = useStore.getState();
  const ids = new Set(doc.nodes.filter((n) => n.kind !== "boundary").map((n) => n.id));
  const boundaries = doc.nodes.filter((n) => n.kind === "boundary");
  // a component belongs to the smallest boundary (region / zone) that contains its centre
  const parentOf = (n: { x: number; y: number }) => boundaries
    .filter((b) => n.x + 94 >= b.x && n.x + 94 <= b.x + (b.w ?? 0) && n.y + 40 >= b.y && n.y + 40 <= b.y + (b.h ?? 0))
    .sort((a, b) => (a.w ?? 0) * (a.h ?? 0) - (b.w ?? 0) * (b.h ?? 0))[0]?.id;
  return {
    nodes: doc.nodes.filter((n) => ids.has(n.id)).map((n) => ({ id: n.id, kind: n.kind, label: n.label, config: n.config, parentId: parentOf(n) })),
    edges: doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

/** Grade a design in the worker; resolves with the full result. */
export const gradeInWorker = (ch: OpenChallenge, grading: Grading, doc: GraphDoc) => getHost().grade(ch, grading, doc);

export const useSim = create<SimStore & { ingest(s: Snapshot, done: boolean): void }>()((set, get) => ({
  status: "idle", speed: 5, time: 0, latest: null, history: [], events: [], saturation: {}, error: null,

  ingest(snap, done) {
    set((s) => {
      if (s.status === "idle") return s; // late snapshot from a run that was reset
      const history = s.history.length >= MAX_HISTORY ? [...s.history.slice(-MAX_HISTORY + 1), snap] : [...s.history, snap];
      const saturation = { ...s.saturation };
      for (const [id, m] of Object.entries(snap.nodes)) {
        const u = m.utilization ?? 0;
        const prev = saturation[id] ?? { peak: 0 };
        saturation[id] = { peak: Math.max(prev.peak, u), firstAt: prev.firstAt ?? (u >= 0.95 ? snap.time : undefined) };
      }
      return { latest: snap, time: snap.time, history, saturation, events: snap.events.length ? [...s.events, ...snap.events].slice(-500) : s.events, status: done ? "done" : s.status };
    });
  },

  async run() {
    const st = useStore.getState();
    const h = getHost();
    if (get().status === "idle" || get().status === "done" || loadedRev !== st.structureRev) {
      const doc = engineDoc();
      if (!doc.nodes.some((n) => n.kind === "client")) { set({ error: "Add a Traffic source to generate load." }); return; }
      h.load(doc, st.doc.scenario);
      loadedRev = st.structureRev;
      set({ history: [], events: [], saturation: {}, time: 0, latest: null, error: null });
    }
    await h.setSpeed(get().speed);
    set({ status: "running", error: null });
    await h.play();
  },
  pause() { void getHost().pause(); set({ status: "paused" }); },
  step() {
    const h = getHost();
    if (get().status === "idle" || get().status === "done") void get().run().then(() => { void h.pause(); set({ status: "paused" }); void h.step(0.1); });
    else { void h.pause(); set({ status: "paused" }); void h.step(0.1); }
  },
  stop() { if (host) void host.pause(); loadedRev = -1; set({ status: "idle", latest: null, history: [], events: [], saturation: {}, time: 0 }); },
  setSpeed(x) { set({ speed: x }); if (host) void host.setSpeed(x); },
  syncConfigs() {
    if (!host || get().status === "idle") return;
    const { doc } = useStore.getState();
    void host.setConfigs(Object.fromEntries(doc.nodes.filter((n) => n.kind !== "boundary").map((n) => [n.id, n.config])));
  },
}));

// Config edits apply live; structural edits invalidate the loaded run.
useStore.subscribe((s, p) => {
  if (s.doc.nodes !== p.doc.nodes && (s.doc.nodes.length !== p.doc.nodes.length || s.doc.nodes.some((n, i) => n.config !== p.doc.nodes[i]?.config))) useSim.getState().syncConfigs();
  if (s.structureRev !== p.structureRev && useSim.getState().status === "running") { useSim.getState().stop(); }
});
