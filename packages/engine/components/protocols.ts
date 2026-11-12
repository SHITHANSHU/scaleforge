import type { ProtocolDef } from "../core/types";

export const builtinProtocols: ProtocolDef[] = [
  { id: "http", label: "HTTP", color: "#38bdf8", description: "Request/response over HTTP(S)." },
  { id: "tcp", label: "TCP", color: "#94a3b8", description: "Raw TCP stream." },
  { id: "websocket", label: "WebSocket", color: "#a78bfa", description: "Long-lived bidirectional connection." },
  { id: "grpc", label: "gRPC", color: "#2dd4bf", description: "HTTP/2 RPC." },
  { id: "database", label: "Database", color: "#fb923c", description: "SQL / NoSQL client protocol." },
  { id: "cache-access", label: "Cache access", color: "#f472b6", description: "Get/set against a cache." },
  { id: "message-queue", label: "Message queue", color: "#facc15", description: "Queue publish/consume (AMQP-style)." },
  { id: "event-stream", label: "Event stream", color: "#4ade80", description: "Append-only log (Kafka-style)." },
  { id: "cdc", label: "CDC", color: "#f87171", description: "Change-data-capture events from a database log." },
];
