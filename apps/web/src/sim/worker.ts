/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { createDefaultRegistry, gradeOpen, Simulation, type ConfigRecord, type Grading, type GraphDoc, type OpenChallenge, type OpenGrade, type Scenario, type Snapshot } from "@scaleforge/engine";

const registry = createDefaultRegistry();
const TICK_MS = 100; // wall-clock cadence of snapshots (10 Hz)

class SimHost {
  private sim: Simulation | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private speed = 1;
  private cb: ((s: Snapshot, done: boolean) => void) | null = null;
  private tickSec = 0.01;

  onSnapshot(cb: (s: Snapshot, done: boolean) => void) { this.cb = cb; }

  load(doc: GraphDoc, scenario: Scenario) {
    this.pause();
    this.sim = new Simulation(registry, doc, scenario);
    this.tickSec = (scenario.tickMs ?? 10) / 1000;
  }
  /** Evaluate a design against every public and hidden scenario, off the UI thread. */
  grade(ch: OpenChallenge, grading: Grading, doc: GraphDoc): OpenGrade { return gradeOpen(registry, ch, grading, doc); }
  setConfigs(c: Record<string, ConfigRecord>) { this.sim?.setConfigs(c); }
  setSpeed(x: number) { this.speed = x; }

  play() {
    if (!this.sim || this.timer) return;
    this.timer = setInterval(() => this.pump((TICK_MS / 1000) * this.speed), TICK_MS);
  }
  pause() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  /** Advance by simulated seconds (default 1 s) while paused. */
  step(sec = 0.1) { this.pump(sec); }

  private pump(simSeconds: number) {
    const sim = this.sim;
    if (!sim) return;
    const n = Math.max(1, Math.round(simSeconds / this.tickSec));
    const t0 = performance.now();
    for (let i = 0; i < n && !sim.done; i++) {
      sim.step();
      if (performance.now() - t0 > TICK_MS * 0.8) break; // never starve the worker loop
    }
    const done = sim.done;
    if (done) this.pause();
    this.cb?.(sim.snapshot(), done);
  }
}

Comlink.expose(new SimHost());
