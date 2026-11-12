import type { Grading, OpenChallenge } from "@scaleforge/engine";

// Every folder in /challenges/open is picked up automatically. Public files load eagerly; grading
// (hidden scenarios), the write-up and the reference load only when the player evaluates or gives up.
const pub = import.meta.glob("../../../../challenges/open/*/challenge.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const grading = import.meta.glob("../../../../challenges/open/*/grading.json", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const writeup = import.meta.glob("../../../../challenges/open/*/writeup.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const reference = import.meta.glob("../../../../challenges/open/*/reference.design.json", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

const idOf = (path: string) => /open\/([^/]+)\//.exec(path)![1]!;
const lazy = (m: Record<string, () => Promise<string>>) => Object.fromEntries(Object.entries(m).map(([p, f]) => [idOf(p), f]));
const G = lazy(grading), W = lazy(writeup), R = lazy(reference);

const LEVELS = ["intermediate", "advanced", "senior", "staff"];
export const openCatalog: OpenChallenge[] = Object.values(pub)
  .map((t) => JSON.parse(t) as OpenChallenge)
  .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.title.localeCompare(b.title));

export const loadGrading = async (id: string) => JSON.parse(await G[id]!()) as Grading;
export const loadWriteup = async (id: string) => (await W[id]?.()) ?? "";
export const loadReference = async (id: string) => JSON.parse(await R[id]!());
export const categories = [...new Set(openCatalog.map((c) => c.category))].sort();
export { LEVELS };
