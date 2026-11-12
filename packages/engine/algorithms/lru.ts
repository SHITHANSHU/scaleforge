/** Least-recently-used cache. Map preserves insertion order, so the first key is the oldest. */
export class LRUCache<K, V = true> {
  private map = new Map<K, V>();
  evictions = 0;
  constructor(readonly capacity: number) {}
  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k)!; this.map.delete(k); this.map.set(k, v); return v;
  }
  set(k: K, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    else if (this.map.size >= this.capacity) { this.map.delete(this.map.keys().next().value as K); this.evictions++; }
    this.map.set(k, v);
  }
  get size() { return this.map.size; }
}
