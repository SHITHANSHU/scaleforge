import { fnv1a } from "./hash";

/** Rendezvous (highest-random-weight) hashing: each key goes to the node with the highest hash(node, key). */
export function rendezvous(key: string | number, nodes: string[]): string {
  let best = nodes[0]!, bestH = -1;
  for (const n of nodes) { const h = fnv1a(`${n}|${key}`); if (h > bestH) { bestH = h; best = n; } }
  return best;
}

/** Fraction of `sample` keys whose owner differs between two node sets, per strategy. */
export function remapFraction(assign: (key: number, nodes: string[]) => string, before: string[], after: string[], sample = 20000): number {
  let moved = 0;
  for (let i = 0; i < sample; i++) if (assign(i, before) !== assign(i, after)) moved++;
  return moved / sample;
}
