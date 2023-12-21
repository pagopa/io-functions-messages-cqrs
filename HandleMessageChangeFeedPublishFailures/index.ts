import { AzureFunction, Context } from "@azure/functions";
import { fromSas } from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import {
  MessageModel,
  MESSAGE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { createBlobService } from "azure-storage";
import { initTelemetryClient } from "../utils/appinsights";
import { getConfigOrThrow } from "../utils/config";
import { cosmosdbInstance } from "../utils/cosmosdb";
import { Failure } from "../utils/errors";
import { avroMessageFormatter } from "../utils/formatter/messagesAvroFormatter";
import { getThirdPartyDataWithCategoryFetcher } from "../utils/message";
import { HandleMessageChangeFeedPublishFailureHandler } from "./handler";

const config = getConfigOrThrow();

const messageModel = new MessageModel(
  cosmosdbInstance.container(MESSAGE_COLLECTION_NAME),
  "message-content" as NonEmptyString
);

const messageContentBlobService = createBlobService(
  config.MESSAGE_CONTENT_STORAGE_CONNECTION
);

const telemetryClient = initTelemetryClient(
  config.APPINSIGHTS_INSTRUMENTATIONKEY
);

const kafkaClient = fromSas(
  config.MESSAGES_TOPIC_CONNECTION_STRING,
  avroMessageFormatter(getThirdPartyDataWithCategoryFetcher(config))
);

export const index: AzureFunction = (
  context: Context,
  message: unknown
): Promise<Failure | void> =>
  HandleMessageChangeFeedPublishFailureHandler(
    context,
    message,
    telemetryClient,
    messageModel,
    messageContentBlobService,
    kafkaClient
  );

export default index;
