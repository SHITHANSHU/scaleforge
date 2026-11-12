import type { Inflow } from "./types";

export interface Merged {
  count: number;
  latencyMs: number;
  readFraction: number;
  dupFraction: number;
}

/** Combine inflows into one count-weighted aggregate. */
export function mergeInflows(inbound: Inflow[]): Merged {
  let count = 0, lat = 0, read = 0, dup = 0;
  for (const f of inbound) {
    count += f.count;
    lat += f.latencyMs * f.count;
    read += f.readFraction * f.count;
    dup += (f.dupFraction ?? 0) * f.count;
  }
  return count > 0
    ? { count, latencyMs: lat / count, readFraction: read / count, dupFraction: dup / count }
    : { count: 0, latencyMs: 0, readFraction: 1, dupFraction: 0 };
}

export interface QueueState {
  depth: number;
}

export interface QueueStep {
  processed: number;
  dropped: number;
  depth: number;
  /** Time an item arriving now waits, ms. */
  waitMs: number;
}

/**
 * Explicit bounded FIFO served at `capacity` items this tick.
 * Overflow beyond `limit` is dropped (reject policy).
 */
export function stepQueue(depth: number, arrivals: number, capacity: number, limit: number, dt: number): QueueStep {
  const total = depth + arrivals;
  const processed = Math.min(total, Math.max(0, capacity));
  const remaining = total - processed;
  const dropped = Math.max(0, remaining - limit);
  const newDepth = remaining - dropped;
  const perSec = capacity / dt;
  return { processed, dropped, depth: newDepth, waitMs: perSec > 0 ? (newDepth / perSec) * 1000 : 0 };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
