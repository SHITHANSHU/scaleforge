// Writes every open challenge (public statement, grading, reference + attempts) under challenges/open/.
// Run: pnpm tsx tools/open-challenges/build.ts
import { write } from "./kit";
import { specs } from "./specs/index";

for (const s of specs) write(s);
console.log(`wrote ${specs.length} open challenges`);
