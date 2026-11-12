import { Box, Cloud, Container, Search, Shield, Database, DatabaseZap, Filter, Gauge, Layers, Network, Radio, Server, Shuffle, Split, Users, Waypoints, Zap, type LucideIcon } from "lucide-react";

const map: Record<string, LucideIcon> = {
  users: Users, split: Split, server: Server, "database-zap": DatabaseZap, waypoints: Waypoints, database: Database, box: Box,
  cloud: Cloud, container: Container, search: Search, shield: Shield, filter: Filter, gauge: Gauge, layers: Layers, network: Network, radio: Radio, shuffle: Shuffle, zap: Zap,
};
export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const C = map[name] ?? Box;
  return <C size={size} className={className} strokeWidth={1.75} aria-hidden />;
}
export const categoryColor: Record<string, string> = {
  traffic: "#a78bfa", network: "#38bdf8", compute: "#f59e0b", cache: "#f472b6", messaging: "#4ade80", data: "#fb923c",
};
export const categoryLabel: Record<string, string> = {
  traffic: "Traffic", network: "Network", compute: "Compute", cache: "Cache", messaging: "Messaging", data: "Data",
};
