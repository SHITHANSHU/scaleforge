Read `plan.md` completely. It is the source of truth for ScaleForge's product vision, architecture, technology choices and implementation roadmap.

Use the Everything Claude Code (ECC) workflow to implement it.

You are acting as a Principal Engineer, Product Designer and Senior Frontend Architect.

IMPORTANT: Do not conduct additional internet research or expand the technology scope. Focus entirely on implementing the existing plan with exceptional UI/UX, clean architecture and extensibility.

# 1. Preserve the existing architecture

Follow the architecture already defined in `plan.md`.

In particular:

- Browser-only application.
- React + TypeScript + Vite.
- pnpm monorepo.
- React Flow for architecture editing.
- Zustand + Immer for state management.
- Simulation engine independent of React.
- Web Worker execution.
- IndexedDB persistence.
- Versioned schemas and migrations.
- JSON-based challenges and scenarios.

Do not introduce a backend, authentication, accounts or server dependencies.

Do not replace technologies without a compelling technical reason.

# 2. UI/UX is the highest priority

The application must NOT look like a generic SaaS dashboard.

Build an intuitive, visually polished engineering workstation.

Use interaction patterns inspired by professional engineering tools such as:

- Excalidraw
- n8n
- Grafana
- Linear
- VS Code
- Modern cloud infrastructure consoles

Do not blindly copy their interfaces.

### Architecture workspace

The architecture editor is the heart of ScaleForge.

Implement:

- Searchable component palette.
- Drag-and-drop infrastructure components.
- Interactive architecture canvas.
- Directional connections with meaningful traffic types.
- Contextual configuration inspector.
- Zoom, pan and minimap.
- Component grouping and infrastructure boundaries.
- Undo/redo.
- Keyboard shortcuts.
- Multi-selection.
- Duplicate, delete and copy/paste.
- Autosave and clear save-state indicators.

### Contextual interactions

The UI should understand what the user selects.

For example:

Selecting Redis should expose:

- Memory configuration.
- TTL.
- Eviction policy.
- Connection limits.
- Throughput limits.
- Cache behaviour.

Selecting Kafka should expose:

- Partitions.
- Replication factor.
- Consumer groups.
- Retention.
- Throughput.
- Producer and consumer configuration.

Selecting EC2 should expose:

- Instance family.
- vCPU.
- Memory.
- CPU credits.
- Network limits.
- Instance count.

Never use a generic configuration form for all components.

Use appropriate controls such as sliders, numeric inputs, dropdowns, switches, presets, inline explanations and derived-value displays.

### Live execution visualization

The architecture canvas itself should become an observability dashboard during execution.

Display:

- Node utilization.
- Connection throughput.
- Queue depth.
- Bottleneck indicators.
- Failed components.
- Latency.
- Cache hit/miss behaviour.
- Consumer lag.

Use meaningful animations to communicate request and event flows.

Provide an execution dock with:

- Run.
- Pause.
- Resume.
- Step.
- Simulation speed.
- Scenario selection.
- Metrics.
- Event timeline.

Make the experience intuitive without requiring users to read documentation first.

### Visual quality

Prioritize:

- Excellent typography.
- Clear visual hierarchy.
- Consistent spacing.
- Dark and light themes.
- Contextual tooltips.
- Useful empty states.
- Subtle animations.
- Keyboard accessibility.
- Responsive layouts.

Avoid unnecessary cards, excessive borders, decorative gradients and dashboard-style layouts.

Do not compromise usability for visual effects.

# 3. Extensibility is a core architectural requirement

ScaleForge must be designed so that new infrastructure components can be added in the future without changing the core simulation engine or rewriting the UI.

The existing `SimComponent` interface in `plan.md` is the starting point.

Strengthen it into a well-defined component extension system.

### Component registration

Implement a component registry.

Each component should register its own:

- Unique identifier.
- Display name.
- Description.
- Category.
- Icon.
- Version.
- Configuration schema.
- Default configuration.
- Configuration UI metadata.
- Simulation implementation.
- Metrics definitions.
- Validation rules.
- Documentation references.
- Connection/port definitions.

### Component isolation

Each component should live in its own module.

For example:

packages/engine/components/
ec2/
load-balancer/
redis/
kafka/
rabbitmq/
debezium/
postgres/
websocket/
bloom-filter/

Adding a new component should not require modifying:

- The simulation scheduler.
- The graph execution engine.
- The global configuration inspector.
- Existing component implementations.
- Existing challenge definitions.

The registry should discover and expose registered components to the UI.

The UI should render configuration controls based on component metadata and reusable field types, with custom editors supported when necessary.

### Connection system

Make ports and connections extensible.

A component should declare its supported input/output types.

Examples:

- HTTP.
- TCP.
- WebSocket.
- gRPC.
- Database.
- Message queue.
- Event stream.
- CDC.
- Cache access.

The graph validator should check connection compatibility.

Do not hardcode connection rules into individual UI components.

### Presets

New infrastructure presets should be independently addable.

Support:

- Default presets.
- Custom presets.
- Versioned presets.
- User-editable values.
- Source references.
- Approximation labels.

### Documentation

Each component should have documentation describing:

- What it represents.
- Configuration parameters.
- What the simulator models.
- What it intentionally simplifies.
- Supported metrics.
- Failure scenarios.
- Real-world references.

### Contributor experience

A contributor should eventually be able to add a component by:

1. Creating a component module.
2. Defining its configuration schema.
3. Implementing the simulation behaviour.
4. Defining its ports and metrics.
5. Adding presets.
6. Adding tests.
7. Registering it.

Provide a component template and clear CONTRIBUTING.md instructions.

A component should be independently testable.

# 4. Keep the simulation engine trustworthy

Follow the fixed-step, flow-based, deterministic simulation architecture in `plan.md`.

Preserve:

- Seeded random number generation.
- Fixed-step simulation clock.
- Explicit queues.
- Traffic classes.
- Latency distributions.
- Resource constraints.
- Failure injection.
- Reproducible experiments.

Keep the engine free from React, DOM and browser-specific APIs.

Every assumption and preset value must remain visible and editable.

Do not invent precise real-world performance figures.

Label approximations clearly.

# 5. Implementation workflow

Use ECC agents and skills intelligently.

Model allocation:

- Opus for complex architecture decisions and design reviews.
- Sonnet for implementation, testing and refactoring.
- Haiku for straightforward exploration and boilerplate.

First inspect the repository and compare its actual state against `plan.md`.

Identify:

- Existing implementation.
- Missing functionality.
- Architectural inconsistencies.
- UI/UX gaps.
- Extensibility gaps.

Then implement incrementally.

Prioritize:

1. Foundation and design system.
2. Architecture workspace and interactions.
3. Component registry and extension contracts.
4. Contextual configuration inspector.
5. Simulation engine integration.
6. Live metrics and execution dock.
7. Persistence and sharing.
8. Challenges and playgrounds.

Adjust the order when repository dependencies require it.

Do not stop after producing an implementation plan.

# 6. Quality gates

For every milestone:

- Run TypeScript checks.
- Run linting.
- Run relevant unit tests.
- Run integration tests.
- Verify the UI using browser automation where available.
- Test keyboard interactions.
- Test empty and error states.
- Test component registration and removal.
- Test backward compatibility of saved architectures.
- Fix regressions before proceeding.

For UI work, do not consider a component complete merely because it renders. Verify the actual interaction and visual behaviour.

Update `plan.md` only after verified implementation.

Maintain accurate completed, pending and blocked statuses.

# Final objective

Build ScaleForge as a polished, extensible, browser-based engineering laboratory.

The experience should make an engineer feel that they are working inside an interactive infrastructure design and experimentation tool, not browsing a collection of educational pages.

Most importantly, adding a new infrastructure component in the future should be straightforward, isolated, documented and testable.

Start by inspecting the repository and `plan.md`, then begin implementing the first milestone. Do not stop at planning.
