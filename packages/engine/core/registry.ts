import type {
  ComponentDefinition, ConfigRecord, FieldSpec, Issue, Preset, ProtocolDef,
} from "./types";

type AnyDef = ComponentDefinition<any, any>;
type Listener = () => void;

/** Check a config against a component's field metadata. Used by graph validation and the UI. */
export function validateConfig(fields: FieldSpec[], config: ConfigRecord): Issue[] {
  const issues: Issue[] = [];
  for (const f of fields) {
    if (f.showIf && config[f.showIf.key] !== f.showIf.equals) continue;
    const v = config[f.key];
    if (v === undefined) { issues.push({ severity: "error", field: f.key, message: `${f.label} is missing` }); continue; }
    if (f.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) issues.push({ severity: "error", field: f.key, message: `${f.label} must be a number` });
      else if (v < f.min || v > f.max) issues.push({ severity: "error", field: f.key, message: `${f.label} must be between ${f.min} and ${f.max}` });
    } else if (f.type === "select") {
      if (!f.options.some((o) => o.value === v)) issues.push({ severity: "error", field: f.key, message: `${f.label}: unknown option "${String(v)}"` });
    } else if (typeof v !== "boolean") issues.push({ severity: "error", field: f.key, message: `${f.label} must be on or off` });
  }
  return issues;
}

/** Single source of truth for components, protocols and presets. Nothing else hardcodes them. */
export class ComponentRegistry {
  private defs = new Map<string, AnyDef>();
  private protocols = new Map<string, ProtocolDef>();
  private customPresets = new Map<string, Preset[]>();
  private listeners = new Set<Listener>();

  registerProtocol(p: ProtocolDef) { this.protocols.set(p.id, p); this.emit(); }
  protocol(id: string) { return this.protocols.get(id); }
  listProtocols() { return [...this.protocols.values()]; }

  register(def: AnyDef, opts: { replace?: boolean } = {}) {
    if (this.defs.has(def.kind) && !opts.replace) throw new Error(`Component "${def.kind}" is already registered`);
    this.defs.set(def.kind, def);
    this.emit();
  }
  unregister(kind: string) { if (this.defs.delete(kind)) { this.customPresets.delete(kind); this.emit(); } }
  get(kind: string) { return this.defs.get(kind); }
  has(kind: string) { return this.defs.has(kind); }
  list() { return [...this.defs.values()]; }

  /** Built-in presets plus user-added ones. */
  presetsFor(kind: string): Preset[] {
    return [...(this.defs.get(kind)?.presets ?? []), ...(this.customPresets.get(kind) ?? [])];
  }
  addPreset(kind: string, preset: Preset) {
    if (!this.defs.has(kind)) throw new Error(`Unknown component "${kind}"`);
    const list = (this.customPresets.get(kind) ?? []).filter((p) => p.id !== preset.id);
    this.customPresets.set(kind, [...list, { ...preset, builtin: false }]);
    this.emit();
  }
  removePreset(kind: string, id: string) {
    this.customPresets.set(kind, (this.customPresets.get(kind) ?? []).filter((p) => p.id !== id));
    this.emit();
  }

  /** For React's useSyncExternalStore. */
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private emit() { this.listeners.forEach((l) => l()); }
}
