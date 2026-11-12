/** Weighted log-bucket histogram: 1 ms .. ~100 s, ~5% bucket width. Cheap percentile estimates. */
const BASE = 1.05;
const MAX_BUCKET = Math.ceil(Math.log(100000) / Math.log(BASE));

export class Histogram {
  private buckets = new Float64Array(MAX_BUCKET + 1);
  total = 0;
  add(valueMs: number, weight: number) {
    if (!(weight > 0) || !Number.isFinite(valueMs)) return;
    const i = Math.min(MAX_BUCKET, Math.max(0, Math.round(Math.log(Math.max(valueMs, 1)) / Math.log(BASE))));
    this.buckets[i]! += weight;
    this.total += weight;
  }
  percentile(p: number): number {
    if (this.total === 0) return 0;
    const target = this.total * p;
    let acc = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      acc += this.buckets[i]!;
      if (acc >= target) return Math.pow(BASE, i);
    }
    return Math.pow(BASE, MAX_BUCKET);
  }
  reset() { this.buckets.fill(0); this.total = 0; }
}

/** Fixed-size ring buffer for time series. */
export class RingBuffer<T> {
  private items: T[] = [];
  private head = 0;
  constructor(private capacity: number) {}
  push(v: T) {
    if (this.items.length < this.capacity) this.items.push(v);
    else { this.items[this.head] = v; this.head = (this.head + 1) % this.capacity; }
  }
  toArray(): T[] { return [...this.items.slice(this.head), ...this.items.slice(0, this.head)]; }
  get length() { return this.items.length; }
}
