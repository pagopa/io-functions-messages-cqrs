import { Context } from "@azure/functions";
import * as TE from "fp-ts/lib/TaskEither";

import {
  UserRCConfigurationModel,
  RetrievedUserRCConfiguration
} from "@pagopa/io-functions-commons/dist/src/models/user_rc_configuration";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";
import { aRetrievedRemoteContentConfiguration } from "../../__mocks__/remote-content";
import { aCosmosResourceMetadata } from "../../__mocks__/models.mock";

import { handleRemoteContentMessageConfigurationChange } from "../handler";
import { NonEmptyString, Ulid } from "@pagopa/ts-commons/lib/strings";
import { CosmosErrors } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { TelemetryClient } from "../../utils/appinsights";

const mockLoggerError = jest.fn();
const contextMock = ({
  log: {
    error: mockLoggerError
  }
} as unknown) as Context;

const mockTrackEvent = jest.fn();
const telemetryClientMock = ({
  trackException: mockTrackEvent
} as unknown) as TelemetryClient;

const aRetrievedUserRCConfiguration: RetrievedUserRCConfiguration = {
  id: (aRetrievedRemoteContentConfiguration.configurationId as unknown) as NonEmptyString,
  userId: aRetrievedRemoteContentConfiguration.userId,
  ...aCosmosResourceMetadata
};

const mockUpsert = jest
  .fn()
  .mockReturnValue(TE.right(aRetrievedUserRCConfiguration));

const mockUserRCConfigurationModel = ({
  upsert: mockUpsert
} as any) as UserRCConfigurationModel;

const defaultStartTime = 0 as NonNegativeInteger;

const handlerWithMocks = handleRemoteContentMessageConfigurationChange(
  contextMock,
  mockUserRCConfigurationModel,
  telemetryClientMock,
  defaultStartTime
);

// ----------------------
// Tests
// ----------------------

describe("CosmosRemoteContentMessageConfigurationChangeFeed", () => {
  beforeEach(() => jest.clearAllMocks());

  it("SHOULD upsert a new UserRCConfiguration GIVEN a new RemoteContentConfiguration", async () => {
    await handlerWithMocks([aRetrievedRemoteContentConfiguration]);
    expect(mockUserRCConfigurationModel.upsert).toBeCalledTimes(1);
    expect(mockLoggerError).not.toBeCalled();
    expect(mockTrackEvent).not.toBeCalled();
  });

  it("SHOULD upsert more new UserRCConfiguration GIVEN more than 1 new RemoteContentConfiguration", async () => {
    await handlerWithMocks([
      aRetrievedRemoteContentConfiguration,
      aRetrievedRemoteContentConfiguration
    ]);
    expect(mockUserRCConfigurationModel.upsert).toBeCalledTimes(2);
    expect(mockLoggerError).not.toBeCalled();
    expect(mockTrackEvent).not.toBeCalled();
  });

  it("SHOULD skip upsert GIVEN a RemoteContentConfiguration with _ts before defaultStartTime", async () => {
    await handlerWithMocks([
      { ...aRetrievedRemoteContentConfiguration, _ts: -1 }
    ]);
    expect(mockUserRCConfigurationModel.upsert).not.toBeCalled();
    expect(mockLoggerError).not.toBeCalled();
    expect(mockTrackEvent).not.toBeCalled();
  });

  it("SHOULD throw an error GIVEN an invalid RCConfiguration", async () => {
    await expect(
      handlerWithMocks([
        {
          ...aRetrievedRemoteContentConfiguration,
          configurationId: "notanulid" as Ulid
        }
      ])
    ).rejects.toThrow();
    expect(mockLoggerError).toBeCalledTimes(1);
    expect(mockTrackEvent).toBeCalledTimes(1);
    expect(mockUserRCConfigurationModel.upsert).not.toBeCalled();
  });

  it("SHOULD throw an error WHEN mockUserRCConfigurationModel.upsert return an Error", async () => {
    mockUpsert.mockReturnValue(
      TE.left(({ kind: "COSMOS_ERROR_RESPONSE" } as unknown) as CosmosErrors)
    );
    await expect(
      handlerWithMocks([aRetrievedRemoteContentConfiguration])
    ).rejects.toThrow();
    expect(mockLoggerError).toBeCalledTimes(1);
    expect(mockTrackEvent).toBeCalledTimes(1);
    expect(mockUserRCConfigurationModel.upsert).toBeCalledTimes(1);
  });
});
