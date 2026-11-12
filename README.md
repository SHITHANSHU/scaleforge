# ScaleForge

A browser-only lab for backend architecture: drop components on a canvas, drive traffic through them, inject failures, and watch the design break. No accounts, no servers.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm check      # typecheck + lint + tests (engine, challenges, golden runs, saved-design compatibility)
pnpm build      # static site in apps/web/dist
```

## Layout

| Path | What |
| --- | --- |
| `packages/engine` | Pure-TS deterministic simulation: `core/` (clock, graph, registry, RNG), `components/` (one folder each), `algorithms/` (Bloom, LRU, LFU, hash ring, token bucket). No DOM/React; lint enforces it. |
| `apps/web` | React + React Flow + Zustand/Immer UI. Simulation runs in a Web Worker. Designs autosave to IndexedDB (Dexie). |
| `challenges/` | One folder per challenge: `challenge.json`, `brief.md`, `writeup.md`, `starter.design.json`, `solution.design.json`. Picked up automatically. |
| `tools/challenge-lint` | CI: every challenge is valid, starter fails, reference solution passes, locks hold. `generate.ts` is an authoring helper. |

## Using it

- **Space** run/pause, **.** step, **⌘K** quick-add, **/** search palette, **⌘Z/⇧⌘Z** undo/redo, **⌘C/⌘V/⌘D** copy/paste/duplicate, **⌘G** group in a boundary, **?** all shortcuts.
- Click empty canvas for the **scenario** (traffic profile, duration, seed, fault injection). Click a component for its own inspector.
- Share: link (compressed into the URL hash), `.sdsim.json` export/import, or a private GitHub Gist with your own token. `?embed=1` gives a read-only view.

See [CONTRIBUTING.md](CONTRIBUTING.md) to add a component, preset or challenge, and [docs/decisions.md](docs/decisions.md) for what the simulator simplifies and why.
