// CI for open-ended challenges: well-formed, no solution leakage, the reference and alternatives pass,
// plausible-but-wrong attempts fail, grading is reproducible, and criteria reference real scenarios.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry, gradeOpen, lockViolationsOpen, validateGraph, type Grading, type GraphDoc, type OpenChallenge } from "../../packages/engine/index";

const reg = createDefaultRegistry();
const root = new URL("../../challenges/open/", import.meta.url).pathname;
const read = (id: string, f: string) => JSON.parse(readFileSync(`${root}${id}/${f}`, "utf8"));
const toDoc = (d: any): GraphDoc => ({ nodes: d.nodes.map((n: any) => ({ id: n.id, kind: n.kind, label: n.label, config: n.config, parentId: n.parentId })), edges: d.edges });

const ids = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

describe("open challenges", () => {
  it("ships a varied catalog", () => {
    expect(ids.length).toBeGreaterThanOrEqual(9);
    const cats = new Set(ids.map((id) => (read(id, "challenge.json") as OpenChallenge).category));
    const levels = new Set(ids.map((id) => (read(id, "challenge.json") as OpenChallenge).level));
    expect(cats.size).toBeGreaterThanOrEqual(7);
    expect(levels.size).toBeGreaterThanOrEqual(3);
  });
  for (const id of ids) {
    describe(id, () => {
      const ch: OpenChallenge = read(id, "challenge.json");
      const grading: Grading = read(id, "grading.json");
      const files = readdirSync(`${root}${id}`);
      const ref = toDoc(read(id, "reference.design.json"));

      it("has a complete public statement and no pre-built solution", () => {
        expect(ch.schemaVersion).toBe(2);
        for (const k of ["situation"] as const) expect(ch.statement[k].length).toBeGreaterThan(80);
        expect(ch.statement.requirements.length).toBeGreaterThanOrEqual(2);
        expect(ch.statement.constraints.length).toBeGreaterThanOrEqual(2);
        expect(ch.learningObjectives.length).toBeGreaterThan(0);
        expect(ch.references.length).toBeGreaterThan(0);
        // the starting canvas holds only fixed items (traffic sources, regions, a legacy system), never the intended architecture
        const placeable = ch.resources.fixed.filter((f) => !["client", "boundary"].includes(f.kind));
        for (const f of placeable) expect(f.locked, `fixed ${f.id} should be locked or partially locked`).toBeTruthy();
      });

      it("doesn't name the solution technology in the problem statement", () => {
        const text = JSON.stringify([ch.statement, ch.summary, ch.title, ch.successCriteria]).toLowerCase();
        const fixedKinds = new Set(ch.resources.fixed.map((f) => f.kind));
        const solutionKinds = [...new Set(ref.nodes.map((n) => n.kind))].filter((k) => !fixedKinds.has(k));
        for (const k of solutionKinds) {
          const def = reg.get(k)!;
          for (const word of [k, def.name.toLowerCase()]) expect(text.includes(word), `statement mentions "${word}"`).toBe(false);
        }
      });

      it("scenarios and criteria are consistent", () => {
        const sids = new Set([...ch.scenarios.map((s) => s.id), ...(grading.hiddenScenarios ?? []).map((s) => s.id)]);
        expect(sids.size).toBe(ch.scenarios.length + (grading.hiddenScenarios?.length ?? 0));
        for (const c of grading.criteria) if (c.scenario !== "all") expect(sids.has(c.scenario), `criterion ${c.id} → ${c.scenario}`).toBe(true);
        for (const sc of ch.successCriteria) expect(sc.label.length).toBeGreaterThan(5);
        expect(grading.criteria.some((c) => c.hard)).toBe(true);
      });

      it("the reference design is valid and respects the rules", () => {
        expect(validateGraph(ref, reg).filter((i) => i.severity === "error")).toEqual([]);
        expect(lockViolationsOpen(ch, ref)).toEqual([]);
      });

      it("the reference passes", () => {
        const g = gradeOpen(reg, ch, grading, ref);
        expect(g.problems).toEqual([]);
        expect(g.results.filter((r) => !r.pass && r.criterion.hard).map((r) => `${r.criterion.label} [${r.scenario}] = ${r.actual}`)).toEqual([]);
        expect(g.pass).toBe(true);
      });

      for (const f of files.filter((x) => x.startsWith("alt-"))) {
        it(`alternative ${f} also passes (multiple valid architectures)`, () => {
          expect(gradeOpen(reg, ch, grading, toDoc(read(id, f))).pass).toBe(true);
        });
      }
      for (const f of files.filter((x) => x.startsWith("attempt-"))) {
        it(`attempt ${f} does not pass`, () => {
          expect(gradeOpen(reg, ch, grading, toDoc(read(id, f))).pass).toBe(false);
        });
      }

      it("grading is reproducible", () => {
        const a = gradeOpen(reg, ch, grading, ref), b = gradeOpen(reg, ch, grading, ref);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      });
    });
  }
});
