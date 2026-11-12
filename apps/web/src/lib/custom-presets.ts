import type { Preset } from "@scaleforge/engine";
import { registry } from "./registry";

const KEY = "sf-custom-presets";
type Store = Record<string, Preset[]>;

const read = (): Store => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const write = (s: Store) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: presets live for this session only */ } };

/** Load user presets into the registry at startup. Presets for unregistered kinds are kept but ignored. */
export function loadCustomPresets() {
  for (const [kind, list] of Object.entries(read())) if (registry.has(kind)) for (const p of list) registry.addPreset(kind, p);
}
export function saveCustomPreset(kind: string, preset: Preset) {
  registry.addPreset(kind, preset);
  const s = read(); s[kind] = [...(s[kind] ?? []).filter((p) => p.id !== preset.id), { ...preset, builtin: false }]; write(s);
}
export function deleteCustomPreset(kind: string, id: string) {
  registry.removePreset(kind, id);
  const s = read(); s[kind] = (s[kind] ?? []).filter((p) => p.id !== id); write(s);
}
