// Golden runs: fixed design + scenario + seed → pinned key metrics.
// If an engine change moves these numbers, explain why in the PR and update the snapshot deliberately.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry, Simulation, type Challenge } from "../index";

const reg = createDefaultRegistry();
const root = new URL("../../../challenges/guided/", import.meta.url).pathname;
const round = (n: number) => Math.round(n * 1000) / 1000;

describe("golden runs", () => {
  for (const id of ["cache-aside-01", "kafka-lag-01", "credit-cliff-01", "cdc-lag-01"]) {
    it(id, () => {
      const ch: Challenge = JSON.parse(readFileSync(`${root}${id}/challenge.json`, "utf8"));
      const d = JSON.parse(readFileSync(`${root}${id}/starter.design.json`, "utf8"));
      const snaps = new Simulation(reg, { nodes: d.nodes, edges: d.edges }, ch.scenario).run(1000);
      const pick = (i: number) => ({ t: round(snaps[i]!.time), thr: round(snaps[i]!.global.throughputRps), err: round(snaps[i]!.global.errorRate), p99: round(snaps[i]!.global.p99) });
      expect([pick(Math.floor(snaps.length / 4)), pick(Math.floor(snaps.length / 2)), pick(snaps.length - 1)]).toMatchSnapshot();
    });
  }
});

describe("performance budget", () => {
  it("50-node graph, 60 simulated seconds, stays within budget", () => {
    const nodes: any[] = [{ id: "c", kind: "client", config: { ...reg.get("client")!.defaults } }, { id: "lb", kind: "load-balancer", config: { ...reg.get("load-balancer")!.defaults } }];
    const edges: any[] = [{ id: "e0", from: "c", fromPort: "out", to: "lb", toPort: "in", protocol: "http" }];
    for (let i = 0; i < 48; i++) {
      nodes.push({ id: `a${i}`, kind: "ec2", config: { ...reg.get("ec2")!.defaults, count: 2 } });
      edges.push({ id: `e${i + 1}`, from: "lb", fromPort: "out", to: `a${i}`, toPort: "in", protocol: "http" });
    }
    const t0 = Date.now();
    new Simulation(reg, { nodes, edges }, { name: "perf", durationSec: 60, seed: 1, traffic: { type: "constant", rps: 2000 }, faults: [] }).run(100);
    const ms = Date.now() - t0;
    console.log(`50-node, 60 sim-seconds: ${ms} ms (${Math.round(60000 / ms)}× realtime)`);
    expect(ms).toBeLessThan(60000 / 20); // ≥ 20× realtime, a loose CI-safe floor under the 100× target
  });
});
