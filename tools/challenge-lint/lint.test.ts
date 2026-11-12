// CI: every challenge is valid, its reference solution passes, its starter fails, and the solution respects locks.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry, gradeChallenge, lockViolations, validateGraph, type Challenge, type GraphDoc } from "../../packages/engine/index";

const reg = createDefaultRegistry();
const root = new URL("../../challenges/guided/", import.meta.url).pathname;
const read = (id: string, f: string) => JSON.parse(readFileSync(`${root}${id}/${f}`, "utf8"));
const toDoc = (d: any): GraphDoc => ({ nodes: d.nodes.map((n: any) => ({ id: n.id, kind: n.kind, label: n.label, config: n.config })), edges: d.edges });

describe("challenges", () => {
  const ids = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  it("ships at least 6", () => expect(ids.length).toBeGreaterThanOrEqual(6));
  for (const id of ids) {
    describe(id, () => {
      const ch: Challenge = read(id, "challenge.json");
      const starter = toDoc(read(id, "starter.design.json")), solution = toDoc(read(id, "solution.design.json"));
      it("designs are valid", () => {
        for (const d of [starter, solution]) expect(validateGraph(d, reg).filter((i) => i.severity === "error")).toEqual([]);
      });
      it("starter fails", () => expect(gradeChallenge(reg, ch, starter).pass).toBe(false));
      it("reference solution passes", () => {
        const g = gradeChallenge(reg, ch, solution);
        expect(g.results.filter((r) => !r.pass).map((r) => `${r.criterion.label}: ${r.actual}`)).toEqual([]);
        expect(g.budgetOk).toBe(true);
      });
      it("solution respects locks", () => expect(lockViolations(ch, starter, solution)).toEqual([]));
      it("is reproducible", () => expect(JSON.stringify(gradeChallenge(reg, ch, solution))).toBe(JSON.stringify(gradeChallenge(reg, ch, solution))));
    });
  }
});
