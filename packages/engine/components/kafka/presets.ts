import type { Preset } from "../../core/types";

const source = { title: "Kafka docs; per-partition/consumer rates are illustrative — replace with your measurements", url: "https://kafka.apache.org/documentation/" };
export const kafkaPresets: Preset[] = [
  { id: "orders-6p", label: "Orders topic (6 partitions)", version: 1, approximate: true, source, builtin: true, values: { partitions: 6, replicationFactor: 3, consumers: 3, consumerRate: 8000 } },
  { id: "high-throughput", label: "High throughput (24 partitions)", version: 1, approximate: true, source, builtin: true, values: { partitions: 24, replicationFactor: 3, consumers: 12, consumerRate: 10000, partitionRate: 20000 } },
];
