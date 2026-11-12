import type { Rng } from "./types";

/** mulberry32: tiny, fast, seedable. Same seed = same run. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  const lognormal = (mean: number, cv: number) => {
    if (mean <= 0) return 0;
    const s2 = Math.log(1 + cv * cv);
    return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * normal());
  };
  return { next, normal, lognormal };
}

/** Derive an independent stream per node so adding a node doesn't reshuffle others. */
export function hashSeed(seed: number, label: string): number {
  let h = seed >>> 0 ^ 2166136261;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619);
  return h >>> 0;
}
