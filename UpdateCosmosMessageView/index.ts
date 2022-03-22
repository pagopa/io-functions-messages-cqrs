import { createBlobService } from "azure-storage";

import { Context } from "@azure/functions";

import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import {
  MessageModel,
  MESSAGE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message";
import {
  MESSAGE_VIEW_COLLECTION_NAME,
  MessageViewModel,
  MessageView
} from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { QueueClient } from "@azure/storage-queue";
import { getConfigOrThrow } from "../utils/config";
import { cosmosdbInstance } from "../utils/cosmosdb";
import { initTelemetryClient } from "../utils/appinsights";
import { handle } from "./handler";

const config = getConfigOrThrow();

const messageViewModel = new MessageViewModel(
  cosmosdbInstance.container(MESSAGE_VIEW_COLLECTION_NAME)
);

const messageModel = new MessageModel(
  cosmosdbInstance.container(MESSAGE_COLLECTION_NAME),
  "message-content" as NonEmptyString
);

const messageContentBlobService = createBlobService(
  config.MESSAGE_CONTENT_STORAGE_CONNECTION
);

const queueClient = new QueueClient(
  config.ERRORS_QUEUE_STORAGE_CONNECTION,
  config.ERRORS_MESSAGE_VIEW_QUEUE_NAME
);

const telemetryClient = initTelemetryClient(
  config.APPINSIGHTS_INSTRUMENTATIONKEY
);

const run = async (
  _context: Context,
  rawMessageStatus: unknown
): Promise<Error | MessageView> =>
  handle(
    telemetryClient,
    messageViewModel,
    messageModel,
    queueClient,
    messageContentBlobService,
    rawMessageStatus
  );

export default run;
