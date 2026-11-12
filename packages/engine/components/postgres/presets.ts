import type { Preset } from "../../core/types";

const source = { title: "Illustrative sizing — calibrate against pgbench / your own workload", url: "https://www.postgresql.org/docs/current/pgbench.html" };
export const postgresPresets: Preset[] = [
  { id: "small", label: "Small (2 vCPU)", version: 1, approximate: true, source, builtin: true, values: { maxConnections: 100, readQps: 4000, writeQps: 1200 } },
  { id: "medium", label: "Medium (8 vCPU)", version: 1, approximate: true, source, builtin: true, values: { maxConnections: 400, readQps: 16000, writeQps: 5000 } },
  { id: "large", label: "Large (32 vCPU)", version: 1, approximate: true, source, builtin: true, values: { maxConnections: 1000, readQps: 60000, writeQps: 18000 } },
];
