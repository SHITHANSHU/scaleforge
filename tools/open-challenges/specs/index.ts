import type { Spec } from "../kit";
import { spec as replicaLoss } from "./replica-loss";
import { spec as flashCrowd } from "./flash-crowd";
import { spec as cacheOutage } from "./cache-outage";
import { spec as retryStorm } from "./retry-storm";
import { spec as orderEvents } from "./order-events";
import { spec as badRelease } from "./bad-release";
import { spec as regionOutage } from "./region-outage";
import { spec as dataRecovery } from "./data-recovery";
import { spec as searchIngest } from "./search-ingest";
import { spec as wsDeploy } from "./ws-deploy";

export const specs: Spec[] = [replicaLoss, flashCrowd, cacheOutage, retryStorm, orderEvents, badRelease, regionOutage, dataRecovery, searchIngest, wsDeploy];
