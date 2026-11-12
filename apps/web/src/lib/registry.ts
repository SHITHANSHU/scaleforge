import { useSyncExternalStore } from "react";
import { createDefaultRegistry } from "@scaleforge/engine";

/** The one registry the UI reads. Register extra components with `registry.register(def)` and the palette, inspector and docs update. */
export const registry = createDefaultRegistry();

let version = 0;
registry.subscribe(() => version++);
export function useRegistry() {
  useSyncExternalStore(registry.subscribe, () => version);
  return registry;
}
