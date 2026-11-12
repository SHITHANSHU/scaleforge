import type { Challenge } from "@scaleforge/engine";
import type { Design } from "../state/types";

export interface Loaded { ch: Challenge; brief: string; writeup: string; starter: Design; solution: Design }

// Every folder in /challenges is picked up automatically: adding one needs no code change.
const files = import.meta.glob("../../../../challenges/guided/*/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const byId: Record<string, Record<string, string>> = {};
for (const [path, text] of Object.entries(files)) {
  const m = /guided\/([^/]+)\/([^/]+)$/.exec(path);
  if (m) (byId[m[1]!] ??= {})[m[2]!] = text;
}

export const catalog: Loaded[] = Object.values(byId)
  .filter((f) => f["challenge.json"])
  .map((f) => ({
    ch: JSON.parse(f["challenge.json"]!) as Challenge,
    brief: f["brief.md"] ?? "",
    writeup: f["writeup.md"] ?? "",
    starter: JSON.parse(f["starter.design.json"]!) as Design,
    solution: JSON.parse(f["solution.design.json"]!) as Design,
  }))
  .sort((a, b) => ["mid", "senior", "staff"].indexOf(a.ch.level) - ["mid", "senior", "staff"].indexOf(b.ch.level) || a.ch.title.localeCompare(b.ch.title));
