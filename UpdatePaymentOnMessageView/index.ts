import { Context } from "@azure/functions";

import { QueueClient } from "@azure/storage-queue";
import {
  MessageViewModel,
  MESSAGE_VIEW_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { initTelemetryClient } from "../utils/appinsights";
import { getConfigOrThrow } from "../utils/config";
import { cosmosdbInstance } from "../utils/cosmosdb";
import { IStorableError } from "../utils/storable_error";
import { handle } from "./handler";

const config = getConfigOrThrow();

const messageViewModel = new MessageViewModel(
  cosmosdbInstance.container(MESSAGE_VIEW_COLLECTION_NAME)
);

const queueClient = new QueueClient(
  config.INTERNAL_STORAGE_CONNECTION_STRING,
  config.MESSAGE_VIEW_PAYMENT_UPDATE_FAILURE_QUEUE_NAME
);

const telemetryClient = initTelemetryClient(
  config.APPINSIGHTS_INSTRUMENTATIONKEY
);

const run = async (
  context: Context,
  rawPaymentUpdate: unknown
): Promise<IStorableError<unknown> | void> =>
  handle(
    context,
    telemetryClient,
    queueClient,
    messageViewModel,
    rawPaymentUpdate
  );

export default run;
