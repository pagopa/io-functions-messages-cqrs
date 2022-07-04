import { AzureFunction, Context } from "@azure/functions";
import {
  MessageViewModel,
  MESSAGE_VIEW_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { paymentUpdaterClient } from "../clients/payment-updater";
import { initTelemetryClient } from "../utils/appinsights";
import { getConfigOrThrow } from "../utils/config";
import { cosmosdbInstance } from "../utils/cosmosdb";
import { Failure } from "../utils/errors";
import { HandlePaymentUpdateFailureHandler } from "./handler";

const config = getConfigOrThrow();

const messageViewModel = new MessageViewModel(
  cosmosdbInstance.container(MESSAGE_VIEW_COLLECTION_NAME)
);

const telemetryClient = initTelemetryClient(
  config.APPINSIGHTS_INSTRUMENTATIONKEY
);

export const index: AzureFunction = (
  context: Context,
  message: unknown
): Promise<Failure | void> =>
  HandlePaymentUpdateFailureHandler(
    context,
    message,
    telemetryClient,
    messageViewModel,
    paymentUpdaterClient
  );

export default index;
