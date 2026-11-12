import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { checkConnection, type ConfigRecord, type Fault, type Scenario } from "@scaleforge/engine";
import { toast } from "../lib/toast";
import { registry } from "../lib/registry";
import { uid } from "../lib/format";
import { defaultScenario, SCHEMA_VERSION, type Design, type DocEdge, type DocNode } from "./types";

type Doc = Pick<Design, "name" | "nodes" | "edges" | "scenario">;
export type SaveState = "saved" | "saving" | "dirty" | "error";

/** What an open-ended challenge allows on the canvas. */
export interface Rules {
  allowed?: string[];
  maxNodes?: number;
  kindDefaults: Record<string, ConfigRecord>;
  kindLocked: Record<string, string[]>;
  fixedIds: string[];
}

interface Clip { nodes: DocNode[]; edges: DocEdge[] }

interface Store {
  id: string;
  doc: Doc;
  past: Doc[];
  future: Doc[];
  selection: { nodes: string[]; edges: string[] };
  clipboard: Clip | null;
  saveState: SaveState;
  /** Bumps on structural change (not config edits) so the sim knows to reset. */
  structureRev: number;
  /** Challenge locks: "nodeId" or "nodeId.configKey". */
  locks: string[];
  setLocks(l: string[]): void;
  rules: Rules | null;
  setRules(r: Rules | null): void;

  commit(): void;
  undo(): void;
  redo(): void;
  load(d: Pick<Design, "id" | "name" | "nodes" | "edges" | "scenario">, opts?: { fromDb?: boolean }): void;
  setName(n: string): void;
  addNode(kind: string, x: number, y: number): string | null;
  moveNodes(moves: Record<string, { x: number; y: number }>): void;
  resizeNode(id: string, w: number, h: number): void;
  updateConfig(id: string, patch: Record<string, number | string | boolean>, opts?: { commit?: boolean }): void;
  applyPreset(id: string, values: Record<string, number | string | boolean>): void;
  setLabel(id: string, label: string): void;
  connect(c: { source: string; sourceHandle: string; target: string; targetHandle: string }): { ok: boolean; reason?: string };
  updateEdge(id: string, patch: Partial<DocEdge>, opts?: { commit?: boolean }): void;
  select(nodes: string[], edges: string[]): void;
  deleteSelection(): void;
  copy(): void;
  paste(at?: { x: number; y: number }): void;
  duplicate(): void;
  groupSelection(): void;
  setScenario(s: Scenario): void;
  addFault(f: Omit<Fault, "id">): void;
  removeFault(id: string): void;
  setSaveState(s: SaveState): void;
}

function pruneSelection(s: Store) {
  const n = new Set(s.doc.nodes.map((x) => x.id)), e = new Set(s.doc.edges.map((x) => x.id));
  s.selection.nodes = s.selection.nodes.filter((i) => n.has(i));
  s.selection.edges = s.selection.edges.filter((i) => e.has(i));
}

const emptyDoc = (): Doc => ({ name: "Untitled design", nodes: [], edges: [], scenario: defaultScenario() });
const HISTORY = 100;

export const useStore = create<Store>()(
  immer((set, get) => {
    /** Snapshot for undo, then mutate. */
    const mutate = (fn: (s: Store) => void, opts: { structural?: boolean; skipHistory?: boolean } = {}) =>
      set((s) => {
        if (!opts.skipHistory) { s.past.push(JSON.parse(JSON.stringify(s.doc))); if (s.past.length > HISTORY) s.past.shift(); s.future = []; }
        fn(s);
        if (opts.structural) s.structureRev++;
        s.saveState = "dirty";
      });

    return {
      id: uid("d"),
      doc: emptyDoc(),
      past: [], future: [],
      selection: { nodes: [], edges: [] },
      clipboard: null,
      saveState: "saved",
      structureRev: 0,
      locks: [],
      setLocks: (l) => set((s) => { s.locks = l; }),
      rules: null,
      setRules: (r) => set((s) => { s.rules = r; }),

      commit: () => set((s) => { s.past.push(JSON.parse(JSON.stringify(s.doc))); if (s.past.length > HISTORY) s.past.shift(); s.future = []; }),
      undo: () => set((s) => {
        const prev = s.past.pop();
        if (!prev) return;
        s.future.push(JSON.parse(JSON.stringify(s.doc)));
        s.doc = prev; s.structureRev++; s.saveState = "dirty";
        pruneSelection(s);
      }),
      redo: () => set((s) => {
        const next = s.future.pop();
        if (!next) return;
        s.past.push(JSON.parse(JSON.stringify(s.doc)));
        s.doc = next; s.structureRev++; s.saveState = "dirty";
        pruneSelection(s);
      }),
      load: (d, opts) => set((s) => {
        s.locks = []; s.rules = null; s.id = d.id; s.doc = { name: d.name, nodes: d.nodes, edges: d.edges, scenario: d.scenario };
        s.past = []; s.future = []; s.selection = { nodes: [], edges: [] }; s.structureRev++; s.saveState = opts?.fromDb ? "saved" : "dirty";
      }),
      setName: (n) => mutate((s) => { s.doc.name = n; }),

      addNode(kind, x, y) {
        if (kind === "boundary") {
          const id = uid("b");
          mutate((s) => { s.doc.nodes.unshift({ id, kind, label: "Boundary", config: {}, x, y, w: 420, h: 260 }); }, { structural: true });
          return id;
        }
        const def = registry.get(kind);
        if (!def) return null;
        const rules = get().rules;
        if (rules?.allowed && !rules.allowed.includes(kind)) { toast(`${def.name} isn't available in this scenario`, "warn"); return null; }
        if (rules?.maxNodes !== undefined && get().doc.nodes.filter((n) => n.kind !== "boundary" && !rules.fixedIds.includes(n.id)).length >= rules.maxNodes) { toast(`This scenario allows at most ${rules.maxNodes} components`, "warn"); return null; }
        const id = uid(kind.slice(0, 3));
        mutate((s) => { s.doc.nodes.push({ id, kind, config: { ...def.defaults, ...(rules?.kindDefaults[kind] ?? {}) }, x, y }); s.selection = { nodes: [id], edges: [] }; }, { structural: true });
        return id;
      },
      moveNodes: (moves) => set((s) => {
        // fixed items (traffic sources, regions) stay put: moving a region would change which components sit inside it
        for (const n of s.doc.nodes) { const m = moves[n.id]; if (m && !s.locks.includes(n.id)) { n.x = m.x; n.y = m.y; } }
        s.saveState = "dirty";
      }),
      resizeNode: (id, w, h) => set((s) => { const n = s.doc.nodes.find((x) => x.id === id); if (n) { n.w = w; n.h = h; s.saveState = "dirty"; } }),
      updateConfig(id, patch, opts) {
        const locks = get().locks;
        if (locks.includes(id) || Object.keys(patch).some((k) => locks.includes(`${id}.${k}`))) return;
        const kindLocked = get().rules?.kindLocked ?? {};
        const kind = get().doc.nodes.find((x) => x.id === id)?.kind ?? "";
        if (Object.keys(patch).some((k) => kindLocked[kind]?.includes(k))) return;
        const cur = get().doc.nodes.find((x) => x.id === id);
        if (!cur || Object.entries(patch).every(([k, v]) => cur.config[k] === v)) return;
        mutate((s) => { const n = s.doc.nodes.find((x) => x.id === id); if (n) Object.assign(n.config, patch); }, { skipHistory: opts?.commit === false });
      },
      applyPreset: (id, values) => get().locks.some((l) => l === id || l.startsWith(`${id}.`)) || Object.keys(values).some((k) => get().rules?.kindLocked[get().doc.nodes.find((x) => x.id === id)?.kind ?? ""]?.includes(k)) ? undefined : mutate((s) => { const n = s.doc.nodes.find((x) => x.id === id); if (n) Object.assign(n.config, values); }),
      setLabel: (id, label) => mutate((s) => { const n = s.doc.nodes.find((x) => x.id === id); if (n) n.label = label; }, { skipHistory: true }),

      connect(c) {
        const { doc } = get();
        const a = doc.nodes.find((n) => n.id === c.source), b = doc.nodes.find((n) => n.id === c.target);
        if (!a || !b) return { ok: false, reason: "Missing node" };
        const res = checkConnection(registry, a.kind, c.sourceHandle, b.kind, c.targetHandle);
        if (!res.ok) return { ok: false, reason: res.reason };
        if (doc.edges.some((e) => e.from === a.id && e.fromPort === c.sourceHandle && e.to === b.id && e.toPort === c.targetHandle))
          return { ok: false, reason: "Already connected" };
        mutate((s) => {
          s.doc.edges.push({ id: uid("e"), from: a.id, fromPort: c.sourceHandle, to: b.id, toPort: c.targetHandle, protocol: res.protocol, latencyMs: 1 });
        }, { structural: true });
        return { ok: true };
      },
      updateEdge: (id, patch, opts) => mutate((s) => { const e = s.doc.edges.find((x) => x.id === id); if (e) Object.assign(e, patch); }, { structural: true, skipHistory: opts?.commit === false }),
      select: (nodes, edges) => set((s) => { s.selection = { nodes, edges }; }),

      deleteSelection() {
        const { selection: sel0, locks } = get();
        const selection = { ...sel0, nodes: sel0.nodes.filter((n) => !locks.some((l) => l === n || l.startsWith(`${n}.`))) };
        if (!selection.nodes.length && !selection.edges.length) return;
        mutate((s) => {
          const gone = new Set(selection.nodes);
          s.doc.nodes = s.doc.nodes.filter((n) => !gone.has(n.id));
          for (const n of s.doc.nodes) if (n.parentId && gone.has(n.parentId)) n.parentId = undefined;
          s.doc.edges = s.doc.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to) && !selection.edges.includes(e.id));
          s.selection = { nodes: [], edges: [] };
        }, { structural: true });
      },
      copy() {
        const { doc, selection } = get();
        const ids = new Set(selection.nodes);
        if (!ids.size) return;
        set((s) => {
          s.clipboard = JSON.parse(JSON.stringify({
            nodes: doc.nodes.filter((n) => ids.has(n.id)),
            edges: doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
          }));
        });
      },
      paste(at) {
        const clip = get().clipboard;
        if (!clip || !clip.nodes.length) return;
        const minX = Math.min(...clip.nodes.map((n) => n.x)), minY = Math.min(...clip.nodes.map((n) => n.y));
        const dx = at ? at.x - minX : 40, dy = at ? at.y - minY : 40;
        const map = new Map<string, string>();
        mutate((s) => {
          for (const n of clip.nodes) {
            const id = uid(n.kind.slice(0, 3)); map.set(n.id, id);
            s.doc.nodes.push({ ...JSON.parse(JSON.stringify(n)), id, x: n.x + dx, y: n.y + dy, parentId: n.parentId && map.get(n.parentId) });
          }
          for (const e of clip.edges) s.doc.edges.push({ ...e, id: uid("e"), from: map.get(e.from)!, to: map.get(e.to)! });
          s.selection = { nodes: [...map.values()], edges: [] };
          s.clipboard = { nodes: clip.nodes.map((n) => ({ ...n, x: n.x + 40, y: n.y + 40 })), edges: clip.edges };
        }, { structural: true });
      },
      duplicate() { get().copy(); get().paste(); },
      groupSelection() {
        const { doc, selection } = get();
        const sel = doc.nodes.filter((n) => selection.nodes.includes(n.id) && n.kind !== "boundary");
        if (!sel.length) return;
        const pad = 40;
        const x = Math.min(...sel.map((n) => n.x)) - pad, y = Math.min(...sel.map((n) => n.y)) - pad - 20;
        const w = Math.max(...sel.map((n) => n.x + 200)) - x + pad, h = Math.max(...sel.map((n) => n.y + 110)) - y + pad;
        const id = uid("b");
        mutate((s) => {
          s.doc.nodes.unshift({ id, kind: "boundary", label: "Boundary", config: {}, x, y, w, h });
          s.selection = { nodes: [id], edges: [] };
        }, { structural: true });
      },

      setScenario: (sc) => mutate((s) => { s.doc.scenario = sc; }, { structural: true }),
      addFault: (f) => mutate((s) => { s.doc.scenario.faults.push({ ...f, id: uid("f") }); }, { structural: true }),
      removeFault: (id) => mutate((s) => { s.doc.scenario.faults = s.doc.scenario.faults.filter((f) => f.id !== id); }, { structural: true }),
      setSaveState: (st) => set((s) => { s.saveState = st; }),
    };
  }),
);

export const designFromStore = (): Design => {
  const s = useStore.getState();
  return { schemaVersion: SCHEMA_VERSION, id: s.id, ...s.doc, updatedAt: Date.now() };
};
