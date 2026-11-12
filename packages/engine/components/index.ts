import { ComponentRegistry } from "../core/registry";
import type { ComponentDefinition } from "../core/types";
import { builtinProtocols } from "./protocols";
import client from "./client";
import ec2 from "./ec2";
import kafka from "./kafka";
import loadBalancer from "./load-balancer";
import postgres from "./postgres";
import redis from "./redis";
import bloomFilter from "./bloom-filter";
import rateLimiter from "./rate-limiter";
import cdn from "./cdn";
import rabbitmq from "./rabbitmq";
import debezium from "./debezium";
import websocket from "./websocket";
import autoscalingGroup from "./autoscaling-group";
import replicatedDb from "./replicated-db";
import apiGateway from "./api-gateway";
import idempotencyStore from "./idempotency-store";
import quorumKv from "./quorum-kv";
import searchCluster from "./search-cluster";
import appService from "./app-service";

/** Step 7 of the contributor guide: add your component here. Nothing else needs to change. */
export const builtinComponents: ComponentDefinition<any, any>[] = [
  client, loadBalancer, rateLimiter, cdn, ec2, autoscalingGroup, websocket, redis, bloomFilter, kafka, rabbitmq, debezium, postgres, replicatedDb,
  apiGateway, idempotencyStore, quorumKv, searchCluster, appService,
];

export function createDefaultRegistry(): ComponentRegistry {
  const reg = new ComponentRegistry();
  builtinProtocols.forEach((p) => reg.registerProtocol(p));
  builtinComponents.forEach((c) => reg.register(c));
  return reg;
}
