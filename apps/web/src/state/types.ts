import type { ConfigRecord, EdgeDoc, Scenario } from "@scaleforge/engine";

export const SCHEMA_VERSION = 1;

export interface DocNode {
  id: string;
  kind: string; // component kind, or "boundary" for visual groups
  label?: string;
  config: ConfigRecord;
  x: number;
  y: number;
  w?: number;
  h?: number;
  parentId?: string;
}
export interface DocEdge extends EdgeDoc {}

export interface Design {
  schemaVersion: number;
  id: string;
  name: string;
  nodes: DocNode[];
  edges: DocEdge[];
  scenario: Scenario;
  updatedAt: number;
}

export const defaultScenario = (): Scenario => ({
  name: "Steady load", durationSec: 120, seed: 42, traffic: { type: "constant", rps: 500 }, faults: [],
});
