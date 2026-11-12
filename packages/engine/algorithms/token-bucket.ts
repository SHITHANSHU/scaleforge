/** Token bucket: sustained `rate` per second, bursts up to `capacity`. */
export class TokenBucket {
  tokens: number;
  constructor(readonly rate: number, readonly capacity: number) { this.tokens = capacity; }
  /** Refill for `dt` seconds, then take up to `want` tokens. Returns how many were allowed. */
  take(want: number, dt: number): number {
    this.tokens = Math.min(this.capacity, this.tokens + this.rate * dt);
    const got = Math.min(want, this.tokens);
    this.tokens -= got;
    return got;
  }
}
