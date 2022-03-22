import { createBlobService } from "azure-storage";

import { Context } from "@azure/functions";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

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

const errorStorage = new TableClient(
  `https://${config.MESSAGE_VIEW_ERROR_STORAGE_ACCOUNT}.table.core.windows.net`,
  config.MESSAGE_VIEW_ERROR_STORAGE_TABLE,
  new AzureNamedKeyCredential(
    config.MESSAGE_VIEW_ERROR_STORAGE_ACCOUNT,
    config.MESSAGE_VIEW_ERROR_STORAGE_KEY
  )
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
    errorStorage,
    messageContentBlobService,
    rawMessageStatus
  );

export default run;
