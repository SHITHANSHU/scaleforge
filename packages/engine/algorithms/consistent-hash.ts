import { fnv1a } from "./hash";

/** Hash ring with virtual nodes. */
export class HashRing {
  private ring: { h: number; node: string }[] = [];
  constructor(nodes: string[], vnodes = 100) {
    for (const n of nodes) for (let v = 0; v < vnodes; v++) this.ring.push({ h: fnv1a(`${n}#${v}`), node: n });
    this.ring.sort((a, b) => a.h - b.h);
  }
  lookup(key: string | number): string {
    const h = fnv1a(key);
    let lo = 0, hi = this.ring.length - 1;
    if (h > this.ring[hi]!.h) return this.ring[0]!.node;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.ring[mid]!.h < h) lo = mid + 1; else hi = mid; }
    return this.ring[lo]!.node;
  }
}

/** Fraction of `sample` uniform keys landing on each node. Fewer vnodes → more imbalance. */
export function ringShares(nodes: string[], vnodes = 20, sample = 4000): Record<string, number> {
  const r = new HashRing(nodes, vnodes);
  const out: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, 0]));
  for (let i = 0; i < sample; i++) out[r.lookup(i)]! += 1 / sample;
  return out;
}
