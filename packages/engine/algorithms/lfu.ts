/** Least-frequently-used cache (ties broken by age). O(n) eviction is fine at lab scale. */
export class LFUCache<K, V = true> {
  private map = new Map<K, { v: V; f: number }>();
  evictions = 0;
  constructor(readonly capacity: number) {}
  get(k: K): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    e.f++; return e.v;
  }
  set(k: K, v: V) {
    const e = this.map.get(k);
    if (e) { e.v = v; e.f++; return; }
    if (this.map.size >= this.capacity) {
      let victim: K | undefined, min = Infinity;
      for (const [key, x] of this.map) if (x.f < min) { min = x.f; victim = key; }
      this.map.delete(victim as K); this.evictions++;
    }
    this.map.set(k, { v, f: 1 });
  }
  get size() { return this.map.size; }
}
