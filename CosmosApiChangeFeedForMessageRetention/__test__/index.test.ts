import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import * as RA from "fp-ts/lib/ReadonlyArray";

import { Ttl } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model_ttl";
import { RejectedMessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/RejectedMessageStatusValue";
import { RejectionReasonEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/RejectionReason";
import { handleSetTTL, isEligibleForTTL, RELEASE_TIMESTAMP } from "../handler";
import {
  aMessageStatus,
  aRetrievedMessageWithoutContent,
  mockMessageModel,
  mockMessageStatusModel,
  mockPatch,
  mockUpdateTTLForAllVersions
} from "../../__mocks__/message";

import { mockProfileFindLast, mockProfileModel } from "../../__mocks__/profile";
import { TelemetryClient } from "../../utils/appinsights";

const ttl = 500 as Ttl;

const anEligibleDocument = {
  ...aMessageStatus,
  status: RejectedMessageStatusValueEnum.REJECTED
};

const mockDocuments = [
  anEligibleDocument,
  anEligibleDocument,
  anEligibleDocument,
  aMessageStatus,
  anEligibleDocument,
  aMessageStatus
];

const mockTrackEvent = jest.fn(_ => void 0);
const mockTelemetryClient = ({
  trackEvent: mockTrackEvent
} as unknown) as TelemetryClient;

describe("isEligibleForTTL", () => {
  it("should return left with reason if the status is not REJECTED", async () => {
    const r = await isEligibleForTTL(mockTelemetryClient)(aMessageStatus)();
    expect(E.isLeft(r)).toBeTruthy();
    if (E.isLeft(r)) {
      expect(r.left).toMatchObject(
        expect.objectContaining({
          document: aMessageStatus,
          reason: "This message status is not rejected"
        })
      );
    }
    expect(mockTelemetryClient.trackEvent).not.toHaveBeenCalled();
  });

  it("should return left with reason if the _ts is after the RELEASE_TIMESTAMP", async () => {
    const aMessageStatusAfterReleaseDate = {
      ...aMessageStatus,
      _ts: 2670524345,
      status: RejectedMessageStatusValueEnum.REJECTED
    };
    const r = await isEligibleForTTL(mockTelemetryClient)(
      aMessageStatusAfterReleaseDate
    )();
    expect(E.isLeft(r)).toBeTruthy();
    expect(mockTelemetryClient.trackEvent).toHaveBeenCalledTimes(1);
    if (E.isLeft(r)) {
      expect(r.left).toMatchObject(
        expect.objectContaining({
          document: aMessageStatusAfterReleaseDate,
          reason: `the timestamp of the document ${
            aMessageStatus.id
          } (${2670524345}) is after the RELEASE_TIMESTAMP ${RELEASE_TIMESTAMP}`
        })
      );
    }
  });

  it("should return left with reason if the document already has a ttl", async () => {
    const messageStatusWithTTL = {
      ...aMessageStatus,
      status: RejectedMessageStatusValueEnum.REJECTED,
      ttl
    };
    const r = await isEligibleForTTL(mockTelemetryClient)(
      messageStatusWithTTL
    )();
    expect(E.isLeft(r)).toBeTruthy();
    expect(mockTelemetryClient.trackEvent).not.toHaveBeenCalled();
    if (E.isLeft(r)) {
      expect(r.left).toMatchObject(
        expect.objectContaining({
          document: messageStatusWithTTL,
          reason: `the document ${aMessageStatus.id} has a ttl already`
        })
      );
    }
  });

  it("should return the retrieved document if it is eligible", async () => {
    const r = await isEligibleForTTL(mockTelemetryClient)(anEligibleDocument)();
    expect(E.isRight(r)).toBeTruthy();
    expect(mockTelemetryClient.trackEvent).not.toHaveBeenCalled();
    if (E.isRight(r)) {
      expect(r.right).toBe(anEligibleDocument);
    }
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("handleSetTTL", () => {
  it("should call the findLastVersionByModelId 4 times but never set the ttl", async () => {
    /*
     * In this scenario we are passing 4 eligible documents so we expect the mockProfileFindLast to have been called 4 times
     * but the ttl should never be setted cause by default mockProfileFindLast return a Some meaning that the user exist.
     * */

    const r = await handleSetTTL(
      mockMessageStatusModel,
      mockMessageModel,
      mockProfileModel,
      mockTelemetryClient,
      mockDocuments
    )();

    expect(RA.lefts(r)).toHaveLength(6);
    expect(mockProfileFindLast).toHaveBeenCalledTimes(4);
    expect(mockUpdateTTLForAllVersions).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockTelemetryClient.trackEvent).toHaveBeenCalledTimes(4);
    expect(mockTelemetryClient.trackEvent).toHaveBeenCalledWith({
      // eslint-disable-next-line sonarjs/no-duplicate-string
      name: "trigger.messages.cqrs.update-not-performed",
      properties: {
        id: anEligibleDocument.id,
        reason: "This profile exist",
        status: anEligibleDocument.status
      }
    });
    expect(mockTelemetryClient.trackEvent).toHaveBeenLastCalledWith({
      name: "trigger.messages.cqrs.update-not-performed",
      properties: {
        id: anEligibleDocument.id,
        reason: "This profile exist",
        status: anEligibleDocument.status
      }
    });
  });

  it("should set the ttl for 4 documents for not registered users", async () => {
    /*
     * In this scenario we are passing 4 eligible documents so we expect the mockProfileFindLast to have been called 4 times,
     * also the mockProfileFindLast return a None meaning the user does not exists, we expect mockUpdateTTLForAllVersions and mockPatch
     * to have been called 4 times then
     * */

    mockProfileFindLast.mockReturnValue(TE.of(O.none));
    const r = await handleSetTTL(
      mockMessageStatusModel,
      mockMessageModel,
      mockProfileModel,
      mockTelemetryClient,
      mockDocuments
    )();

    expect(RA.rights(r)).toHaveLength(4);
    expect(mockProfileFindLast).toHaveBeenCalledTimes(4);
    expect(mockUpdateTTLForAllVersions).toHaveBeenCalledTimes(4);
    expect(mockPatch).toHaveBeenCalledTimes(4);
    expect(mockTrackEvent).toHaveBeenCalledTimes(4);

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: `trigger.messages.cqrs.update-done`,
        properties: {
          id: anEligibleDocument.id,
          status: anEligibleDocument.status
        }
      })
    );
  });

  it("Should call the setTTLForMessageAndStatus without calling the profileModel.findLastVersionByModelId", async () => {
    /*
     * we are passing a document with rejection_reason setted to USER_NOT_FOUND, the mockProfileFindLast should never be called then
     * */
    const r = await handleSetTTL(
      mockMessageStatusModel,
      mockMessageModel,
      mockProfileModel,
      mockTelemetryClient,
      [
        {
          ...anEligibleDocument,
          rejection_reason: RejectionReasonEnum.USER_NOT_FOUND
        }
      ]
    )();

    expect(E.isRight(r[0])).toBeTruthy();
    expect(mockProfileFindLast).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockUpdateTTLForAllVersions).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: `trigger.messages.cqrs.update-done`,
        properties: {
          id: anEligibleDocument.id,
          status: anEligibleDocument.status
        }
      })
    );
  });

  it("Should not call the setTTLForMessageAndStatus and the profileModel.findLastVersionByModelId if rejection reason is SERVICE_NOT_ALLOWED", async () => {
    /*
     * we are passing a document with rejection_reason setted to SERVICE_NOT_ALLOWED,
     * mockProfileFindLast, mockPatch and mockUpdateTTLForAllVersions should never be called then cause we don't want to set the ttl
     * */
    const r = await handleSetTTL(
      mockMessageStatusModel,
      mockMessageModel,
      mockProfileModel,
      mockTelemetryClient,
      [
        {
          ...anEligibleDocument,
          rejection_reason: RejectionReasonEnum.SERVICE_NOT_ALLOWED
        },
        aMessageStatus,
        aMessageStatus
      ]
    )();
    expect(RA.lefts(r)).toHaveLength(3);
    expect(mockProfileFindLast).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockUpdateTTLForAllVersions).not.toHaveBeenCalled();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trigger.messages.cqrs.update-not-performed",
        properties: {
          id: anEligibleDocument.id,
          reason: "The reason of the rejection is not USER_NOT_FOUND",
          status: anEligibleDocument.status
        }
      })
    );
  });

  it("Should return a cosmos error in case of patch fails", async () => {
    mockProfileFindLast.mockReturnValue(TE.of(O.none));
    mockPatch.mockReturnValue(TE.left({ kind: "COSMOS_EMPTY_RESPONSE" }));

    const r = handleSetTTL(
      mockMessageStatusModel,
      mockMessageModel,
      mockProfileModel,
      mockTelemetryClient,
      mockDocuments
    )();

    await expect(r).rejects.toThrowError();
  });

  it("Should return a cosmos error in case of mockUpdateTTLForAllVersions fails", async () => {
    mockProfileFindLast.mockReturnValue(TE.of(O.none));
    mockPatch.mockReturnValue(TE.of(aRetrievedMessageWithoutContent));
    mockUpdateTTLForAllVersions.mockReturnValue(
      TE.left({ kind: "COSMOS_EMPTY_RESPONSE" })
    );
    const r = handleSetTTL(
      mockMessageStatusModel,
      mockMessageModel,
      mockProfileModel,
      mockTelemetryClient,
      mockDocuments
    )();

    await expect(r).rejects.toThrowError();
  });

  it("Should throw an error in case of the retrieve of the profile fails", async () => {
    mockProfileFindLast.mockReturnValue(
      TE.left({ kind: "COSMOS_EMPTY_RESPONSE" })
    );
    const r = handleSetTTL(
      mockMessageStatusModel,
      mockMessageModel,
      mockProfileModel,
      mockTelemetryClient,
      mockDocuments
    )();

    await expect(r).rejects.toThrowError();
  });
});
