import type { ComponentDefinition, ConfigRecord } from "./types";

/** Identity helper that gives contributors full type inference on config and state. */
export function defineComponent<C extends ConfigRecord, S>(def: ComponentDefinition<C, S>): ComponentDefinition<C, S> {
  return def;
}
