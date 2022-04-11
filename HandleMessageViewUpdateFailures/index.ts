import { AzureFunction, Context } from "@azure/functions";
import {
  MessageModel,
  MESSAGE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message";
import {
  MESSAGE_VIEW_COLLECTION_NAME,
  MessageViewModel
} from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { createBlobService } from "azure-storage";
import { initTelemetryClient } from "../utils/appinsights";
import { getConfigOrThrow } from "../utils/config";
import { cosmosdbInstance } from "../utils/cosmosdb";
import { Failure } from "../utils/errors";
import { HandleMessageViewUpdateFailureHandler } from "./handler";

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

const telemetryClient = initTelemetryClient(
  config.APPINSIGHTS_INSTRUMENTATIONKEY
);

export const index: AzureFunction = (
  context: Context,
  message: unknown
): Promise<Failure | void> =>
  HandleMessageViewUpdateFailureHandler(
    context,
    message,
    telemetryClient,
    messageViewModel,
    messageModel,
    messageContentBlobService
  );

export default index;
