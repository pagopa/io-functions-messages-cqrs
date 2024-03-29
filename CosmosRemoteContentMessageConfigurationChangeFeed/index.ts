import { Context } from "@azure/functions";

import {
  UserRCConfigurationModel,
  USER_RC_CONFIGURATIONS_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/user_rc_configuration";
import { remoteContentCosmosDbInstance } from "../utils/cosmosdb";
import { getConfigOrThrow } from "../utils/config";
import { initTelemetryClient } from "../utils/appinsights";
import { handleRemoteContentMessageConfigurationChange } from "./handler";

const config = getConfigOrThrow();

const telemetryClient = initTelemetryClient(
  config.APPINSIGHTS_INSTRUMENTATIONKEY
);

const userRCConfigurationModel = new UserRCConfigurationModel(
  remoteContentCosmosDbInstance.container(
    USER_RC_CONFIGURATIONS_COLLECTION_NAME
  )
);

const run = async (
  context: Context,
  documents: ReadonlyArray<unknown>
): Promise<void> => {
  await handleRemoteContentMessageConfigurationChange(
    context,
    userRCConfigurationModel,
    telemetryClient,
    config.MESSAGE_CONFIGURATION_CHANGE_FEED_START_TIME
  )(documents);
};

export default run;
