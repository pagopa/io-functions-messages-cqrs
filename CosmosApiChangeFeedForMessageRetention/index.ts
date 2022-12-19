import { AzureFunction, Context } from "@azure/functions";
import {
  MessageStatusModel,
  MESSAGE_STATUS_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message_status";
import {
  ProfileModel,
  PROFILE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import {
  MessageModel,
  MESSAGE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { cosmosdbInstance } from "../utils/cosmosdb";
import { getConfigOrThrow } from "../utils/config";
import { initTelemetryClient } from "../utils/appinsights";
import { TelemetryClient } from "../utils/appinsights";
import { handleSetTTL } from "./handler";

const config = getConfigOrThrow();

const messageStatusModel = new MessageStatusModel(
  cosmosdbInstance.container(MESSAGE_STATUS_COLLECTION_NAME)
);

const messageModel = new MessageModel(
  cosmosdbInstance.container(MESSAGE_COLLECTION_NAME),
  "message-content" as NonEmptyString
);

const profileModel = new ProfileModel(
  cosmosdbInstance.container(PROFILE_COLLECTION_NAME)
);

const telemetryClient: TelemetryClient = initTelemetryClient(
  config.APPINSIGHTS_INSTRUMENTATIONKEY
);

const run: AzureFunction = async (
  _: Context,
  documents: ReadonlyArray<unknown>
) =>
  await handleSetTTL(
    messageStatusModel,
    messageModel,
    profileModel,
    telemetryClient,
    documents
  )();

export default run;
