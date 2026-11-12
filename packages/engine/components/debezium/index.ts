import { defineComponent } from "../../core/define";
import { mergeInflows } from "../../core/flow";
import type { SimEvent } from "../../core/types";

interface Config { snapshotMode: string; tableRows: number; snapshotRate: number; connectorRate: number; avgEventBytes: number; walLimitGB: number; [k: string]: number | string }
interface State { phase: "snapshot" | "streaming"; snapshotDone: number; backlog: number; walBytes: number; lagMs: number; util: number; stopped: boolean; full: boolean }

export default defineComponent<Config, State>({
  kind: "debezium",
  sink: true,
  version: "1.0.0",
  name: "Debezium (CDC)",
  description: "Reads a database's change log and publishes events. Models snapshot then streaming, connector lag and WAL growth.",
  category: "messaging",
  icon: "radio",
  ports: [
    { id: "source", direction: "in", label: "DB change log", protocols: ["cdc"] },
    { id: "events", direction: "out", label: "Change events", protocols: ["event-stream", "cdc"] },
  ],
  defaults: { snapshotMode: "initial", tableRows: 5_000_000, snapshotRate: 20000, connectorRate: 10000, avgEventBytes: 600, walLimitGB: 50 },
  fields: [
    { key: "snapshotMode", label: "Snapshot mode", type: "select", group: "Connector", options: [{ value: "initial", label: "Initial", hint: "Copy all rows first, then stream" }, { value: "never", label: "Never", hint: "Stream only new changes" }] },
    { key: "tableRows", label: "Rows to snapshot", type: "number", min: 1000, max: 1e9, step: 1000, scale: "log", group: "Connector" },
    { key: "snapshotRate", label: "Snapshot throughput", type: "number", min: 100, max: 500000, step: 100, unit: "rows/s", scale: "log", group: "Connector" },
    { key: "connectorRate", label: "Streaming throughput", type: "number", min: 100, max: 500000, step: 100, unit: "events/s", scale: "log", group: "Connector" },
    { key: "avgEventBytes", label: "Average change size", type: "number", min: 50, max: 1e6, step: 10, unit: "B", scale: "log", group: "Storage" },
    { key: "walLimitGB", label: "WAL disk budget", type: "number", min: 1, max: 5000, step: 1, unit: "GB", scale: "log", group: "Storage", help: "A lagging or stopped connector pins WAL on the source until the disk fills." },
  ],
  asyncBoundary: true,
  presets: [],
  faults: [{ kind: "connector-stop", label: "Stop connector", description: "Connector crashes; the source keeps retaining WAL." }],
  derived: (c) => c.snapshotMode === "initial"
    ? [{ label: "Snapshot duration", value: `${Math.round(c.tableRows / c.snapshotRate)} s`, tone: c.tableRows / c.snapshotRate > 600 ? "warn" : "ok", help: "Changes during the snapshot queue up in the WAL." }]
    : [{ label: "Snapshot", value: "skipped" }],
  metrics: [
    { id: "utilization", label: "Connector utilization", unit: "%" },
    { id: "lagMs", label: "CDC lag", unit: "ms" },
    { id: "walMB", label: "WAL retained", unit: "MB" },
    { id: "queueDepth", label: "Events behind", unit: "events" },
  ],
  docs: {
    summary: "Change-data-capture connector: snapshot the table, then stream changes from the log into a broker.",
    models: ["Snapshot phase before streaming", "Connector throughput cap and lag", "WAL/binlog growth while the connector lags or is stopped", "Disk-full failure at the WAL budget"],
    simplifies: ["Snapshot progress is a simple rows/throughput counter", "No schema-change breakage or offset rewinds", "One connector task"],
    failureScenarios: ["Connector lags writes → WAL grows", "Snapshot of a large table delays streaming", "Stopped connector fills the source disk"],
    references: [{ title: "Debezium architecture", url: "https://debezium.io/documentation/reference/stable/architecture.html" }],
  },
  init: (c) => ({ phase: c.snapshotMode === "initial" ? "snapshot" : "streaming", snapshotDone: 0, backlog: 0, walBytes: 0, lagMs: 0, util: 0, stopped: false, full: false }),
  validate: (_c, v) => v.incoming.length === 0 ? [{ severity: "warn", message: "No source: connect a PostgreSQL WAL / CDC output" }] : [],
  tick(ctx, c, s, inbound) {
    const m = mergeInflows(inbound);
    const events: SimEvent[] = [];
    const stopped = ctx.faults.some((f) => f.kind === "connector-stop");
    if (stopped && !s.stopped) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "connector-stopped", message: "Debezium connector stopped — WAL is accumulating" });
    let phase = s.phase, snapshotDone = s.snapshotDone;
    let backlog = s.backlog + m.count;
    let emit = 0;
    if (!stopped) {
      if (phase === "snapshot") {
        snapshotDone += c.snapshotRate * ctx.dt;
        emit = c.snapshotRate * ctx.dt; // snapshot rows are published too
        if (snapshotDone >= c.tableRows) { phase = "streaming"; events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "info", kind: "snapshot-complete", message: "Snapshot complete — streaming changes" }); }
      } else {
        emit = Math.min(backlog, c.connectorRate * ctx.dt);
        backlog -= emit;
      }
    }
    const walBytes = backlog * c.avgEventBytes;
    const full = walBytes > c.walLimitGB * 1e9;
    let dropped = 0;
    if (full) { dropped = m.count; backlog -= m.count; if (!s.full) events.push({ time: ctx.time, nodeId: ctx.nodeId, severity: "error", kind: "wal-full", message: "WAL disk full — source database stops accepting writes" }); }
    const lagMs = c.connectorRate > 0 ? (backlog / c.connectorRate) * 1000 : 0;
    return {
      state: { phase, snapshotDone, backlog, walBytes: backlog * c.avgEventBytes, lagMs, util: stopped ? 0 : emit / (Math.max(c.connectorRate, c.snapshotRate || 0, 1) * ctx.dt), stopped, full },
      outbound: [{ port: "events", count: emit, latencyMs: m.latencyMs + 5 + lagMs, readFraction: 0 }],
      dropped, events,
    };
  },
  sample: (_c, s) => ({ utilization: Math.min(1, s.util), lagMs: s.lagMs, walMB: s.walBytes / 1e6, queueDepth: s.backlog }),
});
