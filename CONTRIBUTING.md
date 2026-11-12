# Contributing to ScaleForge

Three paths: add a **challenge** (JSON or a short TypeScript spec, no engine code), add a **preset** (data, no code), add a **component** (TypeScript). Challenge authoring is in [docs/challenge-authoring.md](docs/challenge-authoring.md); sources and modelling decisions are in [docs/research](docs/research) and [docs/decisions.md](docs/decisions.md).

## Add a component

A component is one folder under `packages/engine/components/<kind>/`. You never edit the scheduler, graph engine, inspector or other components.

1. **Copy** `components/_template/` to `components/<kind>/`.
2. **Config schema.** Fill `defaults` and `fields`. Each field is `number` (slider/input, optional `unit`, `scale: "log"`), `select` or `switch`, with `group`, `help` and optional `showIf`. The inspector renders them automatically. Add `derived(config)` for live read-only values (e.g. "max useful consumers"). Need a bespoke control? Set `editor: "name"` on a field and register that editor in the web app.
3. **Simulation.** Implement `init`, `tick(ctx, config, state, inbound)` and `sample`. Rules:
   - Pure TypeScript. No DOM, no React, no `Math.random()` (use `ctx.rng`), no wall clock (use `ctx.time`, `ctx.dt`).
   - Everything is per-tick flow: `inbound` counts arrive, you return `outbound` counts per port. Use `stepQueue` for bounded queues and `mergeInflows` to aggregate.
   - Add your own latency to `latencyMs`; the engine adds edge latency.
   - Emit `events` for things a human should see on the timeline.
   - Outflow on a port with no edge is a dead end and counts as an error — unless the port is `hidden: true` (a terminal port such as "results") or the component sets `sink: true` (a service endpoint). Choose deliberately.
   - Failures from downstream arrive through `ctx.feedback(edgeId)`. If your component retries, falls back or requeues, report what it handled in `recovered`. Messaging boundaries set `asyncBoundary: true`.
   - Duplicates: `Inflow.dupFraction` arrives with the flow; set `dupFraction` on an outflow only if you create or remove duplicates.
   - Regions: components that span regions set `handlesRegionOutage` and react to the `region-outage` fault.
   - Faults your component supports are declared in `faults` and arrive in `ctx.faults`.
4. **Ports & metrics.** Declare `ports` with protocol ids (most specific first; add new protocols via `registry.registerProtocol`). Declare every metric in `metrics`; `sample()` must return each id. Return `utilization` (0..1) if you want canvas colouring.
5. **Presets.** Put them in `presets.ts`: `{ id, label, version, approximate, source, values }`. Never present a number as exact without a `source`; otherwise `approximate: true`.
6. **Docs.** Fill `docs`: summary, what it models, what it **intentionally simplifies**, failure scenarios, real-world references.
7. **Test & register.** Add `<kind>.test.ts` asserting known math (e.g. lag = (in − out) × t) plus `checkComponentContract(def, protocolIds)`. Then add one line to `components/index.ts`.

```sh
pnpm check   # typecheck + lint + tests
```

## Engine rules

`packages/engine` must not import `apps/`, React, or touch browser globals (lint enforces it). Same design + scenario + seed must give identical results.
