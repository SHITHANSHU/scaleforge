import { sc, users, type Spec } from "../kit";

const bad = (at: number, detectSec = 300) => [{ id: "bad", kind: "bad-write", target: "kind:replicated-db", atSec: at, params: { detectSec } }];
const T = { type: "constant" as const, rps: 1800 };
const tick = { tickMs: 50 };

export const spec: Spec = {
  challenge: {
    schemaVersion: 2, kind: "open", id: "the-backup-that-wasnt", title: "The backup that wasn't", category: "Database Reliability", level: "senior", estimatedMinutes: 40,
    tags: ["backup", "restore", "RPO", "RTO", "point-in-time recovery", "operational risk"],
    summary: "A bad deploy corrupts production data. Your replicas have the corruption too. What do you restore from?",
    statement: {
      situation: "Your primary database holds 150 GB and takes about 1,000 writes/s. At some point a bad deploy starts writing corrupt data. It is noticed five minutes later. Because replicas faithfully copy everything, they now hold the corruption as well. Recovery means restoring from a backup — if you have a good one. On a previous project, a nightly backup job had been failing silently for months.",
      symptoms: ["Data is wrong, and failing over to a replica doesn't help", "Nobody knows when the last good backup was taken", "Restoring takes much longer than anyone assumed"],
      requirements: ["Lose no more than 8 minutes of writes (≈ 480,000 writes)", "Restore service within 30 minutes of starting recovery", "Survive the case where backup jobs have been silently failing"],
      constraints: ["Budget: $2.00/hour", "Restore speed and data size are fixed by your infrastructure", "You decide what to back up, how often, and how you know it works"],
    },
    learningObjectives: ["Why replication is not a backup", "RPO and RTO as design inputs", "Point-in-time recovery vs periodic snapshots", "Verifying that backups can be restored"],
    references: [{ title: "GitLab: postmortem of database outage of January 31", url: "https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/" }, { title: "PostgreSQL: continuous archiving and point-in-time recovery", url: "https://www.postgresql.org/docs/current/continuous-archiving.html" }, { title: "PostgreSQL: reliability and the write-ahead log", url: "https://www.postgresql.org/docs/current/wal-reliability.html" }],
    resources: {
      allowed: ["app-service", "replicated-db", "redis", "load-balancer"],
      budget: { maxCostPerHour: 2 },
      fixed: [users({ readRatio: 0.45 })],
      kindDefaults: { "replicated-db": { dataGB: 150, restoreMBps: 120, replayQps: 8000, readQps: 5000, writeQps: 3000, costPerNodeHour: 0.35 }, "app-service": { cpuMsPerReq: 5, vcpuPerPod: 2, hpa: false, pods: 6 } },
      kindLocked: { "replicated-db": ["dataGB", "restoreMBps", "replayQps", "readQps", "writeQps", "costPerNodeHour"], "app-service": ["cpuMsPerReq", "vcpuPerPod"] },
    },
    scenarios: [{ id: "corruption", name: "Corruption at t=1000 s, noticed 5 minutes later", description: "1,800 req/s (≈ 1,000 writes/s). A bad write begins at t=1000 s and is detected at t=1300 s.", scenario: sc("Corruption", T, 3600, bad(1000), tick) }],
    successCriteria: [
      { id: "rpo", label: "At most 8 minutes of writes lost" }, { id: "rto", label: "Service restored within 30 minutes of starting recovery" }, { id: "silent", label: "Also survives backup jobs that were silently failing" }, { id: "cost", label: "Within budget" },
    ],
  },
  grading: {
    schemaVersion: 2, passScore: 70,
    hiddenScenarios: [
      { id: "silent-backups", name: "Same incident, but snapshot jobs had been failing silently", scenario: sc("Silent backup failure", T, 3600, [...bad(1000), { id: "silent", kind: "backup-silent-fail", target: "kind:replicated-db", atSec: 0 }], { ...tick, seed: 3 }) },
      { id: "late", name: "Corruption much later in the day", scenario: sc("Late corruption", T, 5400, bad(3000), { ...tick, seed: 4 }) },
    ],
    criteria: [
      { id: "rpo", label: "Lost writes ≤ 480,000", hard: true, weight: 4, scenario: "all", metric: "replicated-db.dataLoss", agg: "last", nodeAgg: "sum", op: "<=", value: 480000, limit: 2000000 },
      { id: "rto", label: "Write downtime ≤ 30 min", hard: true, weight: 4, scenario: "all", metric: "replicated-db.downtimeSec", agg: "last", nodeAgg: "sum", op: "<=", value: 1800, limit: 5400 },
      { id: "recovered", label: "Data is no longer corrupt at the end", hard: true, weight: 2, scenario: "all", metric: "replicated-db.corrupt", agg: "last", op: "<=", value: 0 },
    ],
  },
  writeup: `
Replication copies writes — all of them, including the bad ones — so it protects against hardware failure, not against corruption or an accidental delete. Only a backup that predates the damage can undo it, and two numbers decide whether that is good enough.

Recovery point (how much you lose): restoring from a periodic snapshot loses everything written since that snapshot, up to a full interval plus the time to notice the problem. Archiving the write-ahead log lets you replay to just before the corruption, so you lose only the writes made while the corruption went unnoticed. Recovery time (how long you are down): restoring 150 GB at the available throughput takes tens of minutes before any log replay, and replay adds to that in proportion to how much log has accumulated since the base backup — so more frequent base backups shorten recovery.

The third lever is trust. A backup job that fails silently gives you a recovery point of 'the beginning of time'. Verifying backups (a restore test, or at least checking each run) turns a silent failure into an alert and a fallback.
`,
  reference: {
    nodes: [["app", "app-service", 260, 220, {}], ["db", "replicated-db", 560, 220, { replicas: 1, snapshotIntervalSec: 900, walArchive: true, backupVerification: true }]],
    edges: [["users", "out", "app", "in"], ["app", "db", "db", "in"]],
  },
  alternatives: {
    "frequent-snapshots-verified": {
      nodes: [["app", "app-service", 260, 220, {}], ["db", "replicated-db", 560, 220, { replicas: 1, snapshotIntervalSec: 120, walArchive: false, backupVerification: true }]],
      edges: [["users", "out", "app", "in"], ["app", "db", "db", "in"]],
    },
  },
  attempts: {
    "defaults": { nodes: [["app", "app-service", 260, 220, {}], ["db", "replicated-db", 560, 220, { replicas: 2 }]], edges: [["users", "out", "app", "in"], ["app", "db", "db", "in"]] },
    "pitr-unverified": { nodes: [["app", "app-service", 260, 220, {}], ["db", "replicated-db", 560, 220, { replicas: 1, snapshotIntervalSec: 900, walArchive: true, backupVerification: false }]], edges: [["users", "out", "app", "in"], ["app", "db", "db", "in"]] },
    "many-replicas": { nodes: [["app", "app-service", 260, 220, {}], ["db", "replicated-db", 560, 220, { replicas: 4 }]], edges: [["users", "out", "app", "in"], ["app", "db", "db", "in"]] },
  },
};
