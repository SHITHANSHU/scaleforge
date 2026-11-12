import Dexie, { type Table } from "dexie";
import LZ from "lz-string";
import { useStore, designFromStore } from "../state/store";
import type { Design } from "../state/types";
import { migrate } from "./schema";
export { migrate, designSchema } from "./schema";

class DB extends Dexie {
  designs!: Table<Design, string>;
  progress!: Table<{ id: string; passedAt: number }, string>;
  constructor() {
    super("scaleforge");
    this.version(1).stores({ designs: "id, updatedAt" });
    this.version(2).stores({ designs: "id, updatedAt", progress: "id" });
  }
}
export const db = new DB();

// ---- File + URL sharing ----
export const exportBundle = (d: Design) => JSON.stringify({ format: "sdsim", ...d }, null, 2);
export function importBundle(text: string): Design { const { format: _f, ...rest } = JSON.parse(text); return migrate(rest); }

export function shareUrl(d: Design): string {
  const { id: _i, updatedAt: _u, ...core } = d;
  return `${location.origin}${location.pathname}#d=${LZ.compressToEncodedURIComponent(JSON.stringify(core))}`;
}
export function designFromHash(): Design | null {
  const m = /[#&]d=([^&]+)/.exec(location.hash);
  if (!m) return null;
  const json = LZ.decompressFromEncodedURIComponent(m[1]!);
  if (!json) throw new Error("Share link is corrupted");
  return migrate({ id: `d_${Date.now().toString(36)}`, updatedAt: Date.now(), ...JSON.parse(json) });
}

// ---- Autosave ----
let timer: ReturnType<typeof setTimeout> | undefined;
export function startAutosave() {
  return useStore.subscribe((s) => {
    if (s.saveState !== "dirty") return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      useStore.getState().setSaveState("saving");
      try { await db.designs.put(designFromStore()); useStore.getState().setSaveState("saved"); }
      catch { useStore.getState().setSaveState("error"); }
    }, 600);
  });
}

export async function loadInitial(): Promise<Design | null> {
  const g = /[#&]gist=([A-Za-z0-9]+)/.exec(location.hash);
  if (g) { try { return await loadGist(g[1]!); } catch (e) { console.warn(e); } }
  try { const fromHash = designFromHash(); if (fromHash) return fromHash; } catch (e) { console.warn(e); }
  try { const all = await db.designs.orderBy("updatedAt").reverse().limit(1).toArray(); return all[0] ? migrate(all[0]) : null; } catch { return null; }
}
export const listDesigns = () => db.designs.orderBy("updatedAt").reverse().toArray();
export const deleteDesign = (id: string) => db.designs.delete(id);

// ---- GitHub Gist sharing (user's own token; nothing is stored) ----
export async function saveGist(token: string, d: Design): Promise<string> {
  const res = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ description: `ScaleForge: ${d.name}`, public: false, files: { "design.sdsim.json": { content: exportBundle(d) } } }),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return (await res.json()).id as string;
}
export async function loadGist(id: string): Promise<Design> {
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Gist not found (${res.status})`);
  const file = Object.values((await res.json()).files as Record<string, { content: string }>)[0];
  if (!file) throw new Error("Gist is empty");
  return importBundle(file.content);
}
