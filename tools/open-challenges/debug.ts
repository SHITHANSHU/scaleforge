// Tuning helper: prints how each design fares. Usage: pnpm tsx tools/open-challenges/debug.ts <id>
import { gradeOpen } from "../../packages/engine/index";
import { reg, toDoc, type Design, type Spec } from "./kit";
import { specs } from "./specs/index";

const only = process.argv[2];
for (const spec of specs as Spec[]) {
  if (only && spec.challenge.id !== only) continue;
  const run = (name: string, d: Design) => {
    const g = gradeOpen(reg, spec.challenge, spec.grading, toDoc(spec.challenge, d));
    console.log(`\n[${spec.challenge.id}] ${name}: ${g.pass ? "PASS" : "FAIL"} score=${g.score.toFixed(0)} valid=${g.valid} ${g.problems.join(" | ")} hard-fail=[${g.hardFailures.join("; ")}]`);
    for (const r of g.results) console.log(`   ${r.pass ? "ok  " : "FAIL"} ${r.criterion.hard ? "H" : " "} ${r.scenario.padEnd(10)} ${r.criterion.label.padEnd(44)} ${Number.isFinite(r.actual) ? r.actual.toPrecision(4) : r.actual}  (${r.score.toFixed(2)})`);
  };
  run("reference", spec.reference);
  for (const [k, d] of Object.entries(spec.alternatives ?? {})) run(`alt:${k}`, d);
  for (const [k, d] of Object.entries(spec.attempts)) run(`attempt:${k}`, d);
}
