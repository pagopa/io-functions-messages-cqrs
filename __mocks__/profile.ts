import * as TE from "fp-ts/lib/TaskEither";
import * as O from "fp-ts/lib/Option";
import {
  CosmosErrors,
  CosmosResource
} from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { aFiscalCode } from "./message";
import {
  Profile,
  ProfileModel,
  RetrievedProfile
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import { ServicesPreferencesModeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServicesPreferencesMode";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";

// CosmosResourceMetadata
export const aCosmosResourceMetadata: Omit<CosmosResource, "id"> = {
  _etag: "_etag",
  _rid: "_rid",
  _self: "_self",
  _ts: 1
};

export const legacyProfileServicePreferencesSettings: RetrievedProfile["servicePreferencesSettings"] = {
  mode: ServicesPreferencesModeEnum.LEGACY,
  version: -1
};

export const aRetrievedProfile: RetrievedProfile = {
  ...aCosmosResourceMetadata,
  fiscalCode: aFiscalCode,
  id: "123" as NonEmptyString,
  isEmailEnabled: true,
  isEmailValidated: true,
  isInboxEnabled: true,
  isTestProfile: false,
  isWebhookEnabled: false,
  kind: "IRetrievedProfile",
  reminderStatus: "UNSET",
  servicePreferencesSettings: legacyProfileServicePreferencesSettings,
  version: 0 as NonNegativeInteger,
  lastAppVersion: "UNKNOWN",
  pushNotificationsContentType: "UNSET"
};

export const mockProfileFindLast = jest.fn(
  (): TE.TaskEither<CosmosErrors, O.Option<RetrievedProfile>> =>
    TE.of(O.some(aRetrievedProfile))
);
export const mockProfileModel = ({
  findLastVersionByModelId: mockProfileFindLast
} as unknown) as ProfileModel;
