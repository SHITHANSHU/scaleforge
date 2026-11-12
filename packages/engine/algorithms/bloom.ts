import { fnv1a } from "./hash";

/** Optimal bit count m and hash count k for n items at false-positive rate p. */
export function bloomParams(n: number, p: number) {
  const m = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}
/** Theoretical false-positive rate with `items` inserted. */
export const bloomFpRate = (m: number, k: number, items: number) => Math.pow(1 - Math.exp((-k * items) / m), k);

/** A real Bloom filter (double hashing). Cheap enough to run on sampled keys in the browser. */
export class BloomFilter {
  private bits: Uint8Array;
  count = 0;
  constructor(readonly m: number, readonly k: number) { this.bits = new Uint8Array(Math.ceil(m / 8)); }
  private idx(key: string | number, i: number) {
    const h1 = fnv1a(key), h2 = fnv1a(key, 0x9e3779b9) | 1;
    return ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
  }
  add(key: string | number) {
    for (let i = 0; i < this.k; i++) { const b = this.idx(key, i); this.bits[b >> 3]! |= 1 << (b & 7); }
    this.count++;
  }
  has(key: string | number) {
    for (let i = 0; i < this.k; i++) { const b = this.idx(key, i); if (!(this.bits[b >> 3]! & (1 << (b & 7)))) return false; }
    return true;
  }
}
