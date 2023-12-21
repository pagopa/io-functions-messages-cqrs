/* eslint-disable @typescript-eslint/naming-convention */ // disabled in order to use the naming convention used to flatten nested object to root ('_' char used as nested object separator)
import { Context } from "@azure/functions";
import { createBlobService } from "azure-storage";
import * as winston from "winston";

import {
  MessageModel,
  MESSAGE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { AzureContextTransport } from "@pagopa/io-functions-commons/dist/src/utils/logging";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";

import { QueueClient } from "@azure/storage-queue";
import { fromSas } from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import { initTelemetryClient } from "../utils/appinsights";
import { getConfigOrThrow } from "../utils/config";
import { cosmosdbInstance } from "../utils/cosmosdb";
import { Failure } from "../utils/errors";
import { avroMessageFormatter } from "../utils/formatter/messagesAvroFormatter";
import { getThirdPartyDataWithCategoryFetcher } from "../utils/message";
import { IBulkOperationResult } from "../utils/publish";
import { handleMessageChange } from "./handler";

// eslint-disable-next-line functional/no-let
let logger: Context["log"] | undefined;
const contextTransport = new AzureContextTransport(() => logger, {
  level: "debug"
});
winston.add(contextTransport);

const config = getConfigOrThrow();

const telemetryClient = initTelemetryClient(
  config.APPINSIGHTS_INSTRUMENTATIONKEY
);

const kafkaClient = fromSas(
  config.MESSAGES_TOPIC_CONNECTION_STRING,
  avroMessageFormatter(getThirdPartyDataWithCategoryFetcher(config))
);

const errorStorage = new QueueClient(
  config.INTERNAL_STORAGE_CONNECTION_STRING,
  config.MESSAGE_PAYMENT_UPDATER_FAILURE_QUEUE_NAME
);

const messageModel = new MessageModel(
  cosmosdbInstance.container(MESSAGE_COLLECTION_NAME),
  "message-content" as NonEmptyString
);

const messageContentBlobService = createBlobService(
  config.MESSAGE_CONTENT_STORAGE_CONNECTION
);

const run = async (
  context: Context,
  documents: ReadonlyArray<unknown>
): Promise<Failure | IBulkOperationResult> => {
  logger = context.log;
  return handleMessageChange(
    messageModel,
    messageContentBlobService,
    config.MESSAGE_CHANGE_FEED_START_TIME
  )(
    kafkaClient,
    errorStorage,
    telemetryClient,
    "messageForPaymentUpdater",
    documents
  );
};

export default run;
