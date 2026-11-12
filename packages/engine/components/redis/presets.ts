import type { Preset } from "../../core/types";

const source = { title: "Redis docs (eviction, benchmarks); ops ceilings are rough single-node figures — measure your own", url: "https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/benchmarks/" };
export const redisPresets: Preset[] = [
  { id: "small-cache", label: "Small cache (1 GB)", version: 1, approximate: true, source, builtin: true, values: { memoryMB: 1024, opsLimit: 80000, maxClients: 10000 } },
  { id: "large-cache", label: "Large cache (16 GB)", version: 1, approximate: true, source, builtin: true, values: { memoryMB: 16384, opsLimit: 100000, maxClients: 10000 } },
  { id: "session-store", label: "Session store (no eviction)", version: 1, approximate: true, source, builtin: true, values: { memoryMB: 2048, evictionPolicy: "noeviction", ttlSec: 1800 } },
];
