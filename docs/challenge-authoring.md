# Writing an open-ended challenge

A challenge is a folder under `challenges/open/<id>/`. The public statement and the grading are separate files so what the player sees never contains the answer.

```
challenge.json          public: situation, symptoms, requirements, constraints, fixed items, allowed components, public scenarios, success criteria (words)
grading.json            private-ish: hidden scenarios + the numeric criteria, weights, pass score (loaded only when the player evaluates)
writeup.md              trade-offs; revealed after passing or giving up
reference.design.json   a design that passes
alt-<name>.design.json  other valid architectures (must also pass)
attempt-<name>.design.json  plausible but wrong designs (must NOT pass)
```

Authoring is easiest in TypeScript: copy `tools/open-challenges/specs/replica-loss.ts`, edit, register it in `specs/index.ts`, then

```sh
pnpm tsx tools/open-challenges/debug.ts <challenge-id>   # prints how reference/alternatives/attempts score, criterion by criterion
pnpm tsx tools/open-challenges/build.ts                  # writes the JSON files
pnpm test                                                # lint: passes/fails as required, no solution leakage, reproducible
```

## Design rules

- **Describe a situation, not a technology.** The statement may not name any component the reference uses (CI checks this). Symptoms, requirements and constraints only.
- **Blank canvas.** `resources.fixed` holds only what the player can't choose: the traffic source (locked), regions/boundaries, a legacy service. Never the intended architecture.
- **Fix what shouldn't be negotiable** with `kindLocked` (e.g. instance capacity and price, per-consumer processing rate) so a slider can't buy the answer. Allow what they should decide.
- **Constraints that bite.** A budget (`resources.budget`, judged on *peak* spend), a component whitelist (`allowed`), `maxNodes`, region round-trip (`scenario.regionRttMs`).
- **Hidden scenarios** test that a design generalises: a different failure, a bigger peak, a different seed. A design that only handles the visible case should fail.
- **Criteria are yours.** Each has a metric (`e2e.*` or `<component>.<metric>`), an aggregation (`max|min|mean|last|first|settleSec`), a window (`after`, `before`), an operator and value, optional `limit` for partial credit, `weight`, and `hard` for must-haves. `settleSec` measures time-to-recovery.
- **Multiple valid designs.** Add `alt-*` designs that pass by a different route, and `attempt-*` designs for the common wrong answers. CI runs them all.
- **Faults target** a node id, a boundary id (region outage), an edge id (`edge-latency`), or `kind:<component>` to hit whatever the player placed.
- **No hints by default.** Add `hints` (optional, revealed one at a time) only if the problem needs them.

## Metrics available to criteria

`e2e.p50|p95|p99|errorRate|availability|throughput|offered|retryRps|retryRatio|goodputRatio|duplicateRate|costPerHour`, and every metric a component declares (`replicated-db.dataLoss`, `kafka.lagMax`, `app-service.versionErrorPct`, …). Node metrics reduce across nodes of that kind with `nodeAgg` (`max` by default for `<`, `min` for `>`, or `sum`). An unknown metric never passes.
