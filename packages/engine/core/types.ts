// Public contracts of the engine. Pure TS: no DOM, no React.

export type ConfigValue = number | string | boolean;
export type ConfigRecord = Record<string, ConfigValue>;

// ---------- Protocols & ports ----------

export interface ProtocolDef {
  id: string;
  label: string;
  /** CSS color used for edges of this type. */
  color: string;
  description: string;
}

export interface PortSpec {
  id: string;
  direction: "in" | "out";
  label: string;
  /** Protocols this port can speak, most specific first. A connection needs one in common; the first shared wins. */
  protocols: string[];
  /** Not drawn as a handle; flow leaving it completes the request when nothing is attached. */
  hidden?: boolean;
}

// ---------- Config UI metadata ----------

interface FieldBase {
  key: string;
  label: string;
  group?: string;
  help?: string;
  /** Only show/validate when another field has this value. */
  showIf?: { key: string; equals: ConfigValue };
  /** Name of a custom editor registered in the UI. Falls back to the field type. */
  editor?: string;
}

export interface NumberField extends FieldBase {
  type: "number";
  min: number;
  max: number;
  step?: number;
  unit?: string;
  control?: "slider" | "input";
  scale?: "linear" | "log";
}
export interface SelectField extends FieldBase {
  type: "select";
  options: { value: string; label: string; hint?: string }[];
}
export interface SwitchField extends FieldBase {
  type: "switch";
}
export type FieldSpec = NumberField | SelectField | SwitchField;

export interface DerivedValue {
  label: string;
  value: string;
  help?: string;
  tone?: "ok" | "warn" | "bad";
}

// ---------- Presets ----------

export interface Preset {
  id: string;
  label: string;
  version: number;
  /** Every shipped number is an approximation until calibrated. */
  approximate: boolean;
  source?: { title: string; url?: string };
  values: Record<string, ConfigValue>;
  builtin?: boolean;
}

// ---------- Docs / metrics ----------

export interface ComponentDocs {
  summary: string;
  /** What the simulator models. */
  models: string[];
  /** What it intentionally simplifies. */
  simplifies: string[];
  failureScenarios: string[];
  references: { title: string; url?: string }[];
}

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  description?: string;
}

// ---------- Flow ----------

export interface Inflow {
  port: string;
  edgeId: string;
  protocol: string;
  /** Items arriving during this tick. */
  count: number;
  /** Mean latency already accumulated by these items (ms). */
  latencyMs: number;
  /** Fraction of items that are reads (0..1). */
  readFraction: number;
  /** Fraction that are duplicates of work already done (retries, redelivery). Defaults to 0. */
  dupFraction?: number;
}

export interface Outflow {
  port: string;
  count: number;
  /** Mean accumulated latency including this node's contribution (ms). */
  latencyMs: number;
  readFraction: number;
  /** Target one edge; otherwise split evenly across the port's edges. */
  edgeId?: string;
  /** Duplicate fraction. If omitted the engine carries over this node's inbound average. */
  dupFraction?: number;
  /** Completes successfully without entering latency percentiles (e.g. documents indexed, which no caller waits on). */
  silent?: boolean;
  /** Of `count`, how many are retries of earlier failures (excluded from "offered", reported as retry load). */
  retryCount?: number;
}

/** What happened to items sent along an edge during the previous tick. */
export interface EdgeFeedback { sent: number; failed: number; /** Subset of `failed` that were client-side timeouts (work may still have executed). */ timedOut: number }

export interface SimEvent {
  time: number;
  nodeId: string;
  severity: "info" | "warn" | "error";
  kind: string;
  message: string;
}

export interface ActiveFault {
  kind: string;
  params: Record<string, ConfigValue>;
  /** True only on the tick the fault begins. */
  justStarted: boolean;
}

export interface TickContext {
  /** Tick length in seconds. */
  dt: number;
  /** Simulated seconds since start. */
  time: number;
  /** Total offered load from the scenario profile at this instant (req/s). */
  rps: number;
  rng: Rng;
  nodeId: string;
  /** Round trip added to edges that cross regions (scenario setting), for components that span regions themselves. */
  regionRttMs: number;
  /** Edge ids leaving each out-port. */
  outEdges: Record<string, string[]>;
  isEdgeTargetDown(edgeId: string): boolean;
  /** Items sent / failed on an out-edge last tick. Failures propagate from anywhere downstream. */
  feedback(edgeId: string): EdgeFeedback;
  /** Faults currently active on this node (engine handles kill-node itself). */
  faults: ActiveFault[];
}

export interface TickResult<S> {
  state: S;
  outbound: Outflow[];
  dropped: number;
  events: SimEvent[];
  /**
   * Downstream failures this node handled itself this tick (retried, fell back, shed intentionally).
   * They are not propagated upstream and not counted as user-visible errors.
   */
  recovered?: number;
}

export interface Rng {
  next(): number;
  normal(): number;
  /** Lognormal with the given mean and coefficient of variation. */
  lognormal(mean: number, cv: number): number;
}

// ---------- Validation ----------

export interface Issue {
  severity: "error" | "warn" | "info";
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}

export interface GraphView {
  nodeId: string;
  incoming: { fromKind: string; port: string; edgeId: string }[];
  outgoing: { toKind: string; port: string; edgeId: string }[];
}

// ---------- The extension point ----------

export interface FaultDef { kind: string; label: string; description: string }

export type Category = "traffic" | "network" | "compute" | "cache" | "messaging" | "data";

export interface ComponentDefinition<C extends ConfigRecord = ConfigRecord, S = unknown> {
  /** Unique id, e.g. "redis". */
  kind: string;
  /** Semver of the model; bump when behavior changes. */
  version: string;
  name: string;
  description: string;
  category: Category;
  /** Icon name from the lucide set, resolved by the UI. */
  icon: string;
  ports: PortSpec[];
  defaults: C;
  fields: FieldSpec[];
  presets: Preset[];
  /** Live read-only values shown under the form. */
  derived?(config: C): DerivedValue[];
  metrics: MetricDef[];
  docs: ComponentDocs;
  init(config: C): S;
  tick(ctx: TickContext, config: C, state: S, inbound: Inflow[]): TickResult<S>;
  sample(config: C, state: S): Record<string, number>;
  /** True for service endpoints: flow leaving an unconnected output ends the request successfully. For everything else an unconnected output is a dead end and counts as an error. */
  sink?: boolean;
  /** True if the component spans regions itself and wants a `region-outage` fault instead of being killed with its boundary. */
  handlesRegionOutage?: boolean;
  /** True for async boundaries (queues, logs): downstream failures are not reported back to producers. */
  asyncBoundary?: boolean;
  /** Component-specific faults users can schedule. "kill-node" works on every component. */
  faults?: FaultDef[];
  validate?(config: C, view: GraphView): Issue[];
  /** Receives live state so elastic components (autoscaling) can price their actual fleet. */
  costPerHour?(config: C, state?: S): number;
}
