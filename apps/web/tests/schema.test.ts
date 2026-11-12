import { describe, expect, it } from "vitest";
import legacy from "./fixtures/v0-design.json";
import { migrate } from "../src/lib/schema";
import { SCHEMA_VERSION } from "../src/state/types";

describe("saved design compatibility", () => {
  it("migrates a pre-versioning (v0) file to the current schema", () => {
    const d = migrate(legacy);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.nodes).toHaveLength(2);
    expect(d.scenario.traffic.type).toBe("constant"); // default added by migration
    expect(d.id).toMatch(/^d_/);
  });
  it("round-trips a current design", () => {
    const d = migrate(legacy);
    expect(migrate(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it("rejects designs from a newer version and malformed input", () => {
    expect(() => migrate({ ...migrate(legacy), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer version/);
    expect(() => migrate(null)).toThrow();
    expect(() => migrate({ schemaVersion: 1, id: "x", name: "x", nodes: [{ id: 1 }], edges: [], scenario: {}, updatedAt: 0 })).toThrow();
  });
});
