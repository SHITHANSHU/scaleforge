import type { Scenario } from "@scaleforge/engine";
import { registry } from "./registry";
import { uid } from "./format";
import type { Design, DocEdge, DocNode } from "../state/types";

type Spec = { id: string; kind: string; x: number; y: number; label?: string; config?: Record<string, number | string | boolean>; preset?: string };
type Link = [string, string, string, string];

function build(name: string, specs: Spec[], links: Link[], scenario: Scenario): Pick<Design, "id" | "name" | "nodes" | "edges" | "scenario"> {
  const nodes: DocNode[] = specs.map((s) => {
    const def = registry.get(s.kind)!;
    const preset = s.preset ? registry.presetsFor(s.kind).find((p) => p.id === s.preset)?.values : {};
    return { id: s.id, kind: s.kind, label: s.label, x: s.x, y: s.y, config: { ...def.defaults, ...preset, ...s.config } };
  });
  const edges: DocEdge[] = links.map(([from, fromPort, to, toPort]) => {
    const a = registry.get(nodes.find((n) => n.id === from)!.kind)!, b = registry.get(nodes.find((n) => n.id === to)!.kind)!;
    const protocol = a.ports.find((p) => p.id === fromPort)!.protocols.find((p) => b.ports.find((q) => q.id === toPort)!.protocols.includes(p))!;
    return { id: uid("e"), from, fromPort, to, toPort, protocol, latencyMs: 1 };
  });
  return { id: uid("d"), name, nodes, edges, scenario };
}

const sc = (name: string, rps: number, extra: Partial<Scenario> = {}): Scenario => ({ name, durationSec: 180, seed: 42, traffic: { type: "constant", rps }, faults: [], ...extra });

export const templates = [
  { id: "cache-aside", title: "Cache-aside API" },
  { id: "kafka-lag", title: "Kafka consumer lag" },
  { id: "credit-cliff", title: "t2.micro credit cliff" },
] as const;

export function loadTemplate(id: (typeof templates)[number]["id"]) {
  switch (id) {
    case "cache-aside":
      return build("Cache-aside API", [
        { id: "c", kind: "client", x: 0, y: 120 },
        { id: "lb", kind: "load-balancer", x: 230, y: 120 },
        { id: "app", kind: "ec2", x: 460, y: 120, label: "API fleet", config: { count: 4, vcpu: 2, burstable: false, cpuCostMs: 8, networkMbps: 750, creditsPerHour: 0, initialCredits: 0 } },
        { id: "r", kind: "redis", x: 690, y: 120, config: { memoryMB: 256, keyspace: 2_000_000, avgItemKB: 2 } },
        { id: "db", kind: "postgres", x: 920, y: 120, preset: "small" },
      ], [["c", "out", "lb", "in"], ["lb", "out", "app", "in"], ["app", "out", "r", "in"], ["r", "miss", "db", "in"]],
      sc("Ramp to find the ceiling", 0, { traffic: { type: "ramp", fromRps: 200, toRps: 6000 } }));
    case "kafka-lag":
      return build("Kafka consumer lag", [
        { id: "c", kind: "client", x: 0, y: 100 },
        { id: "app", kind: "ec2", x: 240, y: 100, label: "Producer", config: { count: 4, vcpu: 2, burstable: false, cpuCostMs: 1, networkMbps: 750 } },
        { id: "k", kind: "kafka", x: 480, y: 100, config: { partitions: 6, consumers: 8, consumerRate: 8000 } },
      ], [["c", "out", "app", "in"], ["app", "out", "k", "produce"]], sc("50k/s input", 50000, { durationSec: 120 }));
    case "credit-cliff":
      return build("t2.micro credit cliff", [
        { id: "c", kind: "client", x: 0, y: 100 },
        { id: "app", kind: "ec2", x: 240, y: 100, preset: "t2.micro", config: { count: 1, cpuCostMs: 10, initialCredits: 8 } },
      ], [["c", "out", "app", "in"]], sc("90 rps steady", 90, { durationSec: 600 }));
  }
}
