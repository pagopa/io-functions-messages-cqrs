import { AzureFunction, Context } from "@azure/functions";
import {
  MessageStatusModel,
  RetrievedMessageStatus
} from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { ProfileModel } from "@pagopa/io-functions-commons/dist/src/models/profile";
import { Container } from "@azure/cosmos";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { cosmosdbClient } from "../utils/cosmosdb";
import { getConfigOrThrow } from "../utils/config";
import { handleSetTTL } from "./handler";

const config = getConfigOrThrow();

const messageStatusContainer: Container = cosmosdbClient
  .database(config.COSMOSDB_NAME)
  .container(config.COSMOSDB_MESSAGE_STATUS_CONTAINER_NAME);
const messageStatusModel = new MessageStatusModel(messageStatusContainer);

const messageContainer = cosmosdbClient
  .database(config.COSMOSDB_NAME)
  .container(config.COSMOSDB_MESSAGES_CONTAINER);
const messageModel = new MessageModel(
  messageContainer,
  config.COSMOSDB_MESSAGES_CONTAINER
);

const profileContainer: Container = cosmosdbClient
  .database(config.COSMOSDB_NAME)
  .container(config.COSMOSDB_PROFILES_COLLECTION);
const profileModel = new ProfileModel(profileContainer);

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
