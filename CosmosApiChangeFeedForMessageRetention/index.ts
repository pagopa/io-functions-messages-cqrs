import { AzureFunction, Context } from "@azure/functions";
import {
  MessageStatusModel,
  MESSAGE_STATUS_COLLECTION_NAME,
  RetrievedMessageStatus
} from "@pagopa/io-functions-commons/dist/src/models/message_status";
import {
  ProfileModel,
  PROFILE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import {
  MessageModel,
  MESSAGE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { cosmosdbInstance } from "../utils/cosmosdb";
import { getConfigOrThrow } from "../utils/config";
import { handleSetTTL } from "./handler";

const config = getConfigOrThrow();

const messageStatusModel = new MessageStatusModel(
  cosmosdbInstance.container(MESSAGE_STATUS_COLLECTION_NAME)
);

const messageModel = new MessageModel(
  cosmosdbInstance.container(MESSAGE_COLLECTION_NAME),
  config.COSMOSDB_MESSAGES_CONTAINER
);

const profileModel = new ProfileModel(
  cosmosdbInstance.container(PROFILE_COLLECTION_NAME)
);

const run: AzureFunction = async (
  context: Context,
  documents: ReadonlyArray<RetrievedMessageStatus>
) =>
  await handleSetTTL(
    messageStatusModel,
    messageModel,
    profileModel,
    context,
    documents
  )();

export default run;
