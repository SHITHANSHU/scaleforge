import type { ConfigValue } from "./types";

export type TrafficProfile =
  | { type: "constant"; rps: number }
  | { type: "ramp"; fromRps: number; toRps: number }
  | { type: "step"; baseRps: number; stepRps: number; atSec: number }
  | { type: "spike"; baseRps: number; spikeRps: number; atSec: number; widthSec: number }
  | { type: "pulses"; baseRps: number; peakRps: number; firstAtSec: number; widthSec: number; everySec: number; count: number };

export interface Fault {
  id: string;
  /** "kill-node" and "edge-latency" are handled by the engine; others are delivered to the node. */
  kind: string;
  /** Node id, edge id (edge-latency), boundary id (region/zone outage), or "kind:<component>" to hit every node of that kind. */
  target: string;
  atSec: number;
  /** Omit for instantaneous / permanent faults. */
  untilSec?: number;
  params?: Record<string, ConfigValue>;
}

export interface Scenario {
  name: string;
  durationSec: number;
  /** Simulated tick in ms. Default 10. */
  tickMs?: number;
  seed: number;
  traffic: TrafficProfile;
  faults: Fault[];
  /** Client-side deadline: requests finishing slower than this count as failed (and are retried by retrying clients). */
  timeoutMs?: number;
  /** Extra latency on any edge whose endpoints sit in different regions (boundaries). */
  regionRttMs?: number;
}

export function rpsAt(p: TrafficProfile, t: number, duration: number): number {
  switch (p.type) {
    case "constant": return p.rps;
    case "ramp": return p.fromRps + (p.toRps - p.fromRps) * Math.min(1, t / Math.max(duration, 1e-9));
    case "step": return t >= p.atSec ? p.stepRps : p.baseRps;
    case "spike": return t >= p.atSec && t < p.atSec + p.widthSec ? p.spikeRps : p.baseRps;
    case "pulses": {
      if (t < p.firstAtSec) return p.baseRps;
      const k = Math.floor((t - p.firstAtSec) / p.everySec);
      return k < p.count && (t - p.firstAtSec) - k * p.everySec < p.widthSec ? p.peakRps : p.baseRps;
    }
  }
}
