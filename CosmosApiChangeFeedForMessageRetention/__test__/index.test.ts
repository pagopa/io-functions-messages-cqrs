import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";

import { Ttl } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model_ttl";
import { RejectedMessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/RejectedMessageStatusValue";
import { Context } from "@azure/functions";
import { handleSetTTL, isEligibleForTTL, RELEASE_TIMESTAMP } from "../handler";
import {
  aMessageStatus,
  mockMessageModel,
  mockMessageStatusModel,
  mockPatch,
  mockUpdateTTLForAllVersions
} from "../../__mocks__/message";

import { mockProfileFindLast, mockProfileModel } from "../../__mocks__/profile";

const ttl = 500 as Ttl;

const anEligibleDocument = {
  ...aMessageStatus,
  status: RejectedMessageStatusValueEnum.REJECTED
};

const mockContext = ({
  bindings: {},
  done: jest.fn(),
  log: jest.fn()
} as unknown) as Context;

const mockDocuments = [
  anEligibleDocument,
  anEligibleDocument,
  anEligibleDocument,
  aMessageStatus,
  anEligibleDocument,
  aMessageStatus
];

describe("isEligibleForTTL", () => {
  it("should return a string if the status is not REJECTED", async () => {
    const r = await isEligibleForTTL(aMessageStatus)();
    expect(E.isLeft(r)).toBeTruthy();
    if (E.isLeft(r)) {
      expect(r.left).toBe("This message status is not rejected");
    }
  });

  it("should return a string if the _ts is after the RELEASE_TIMESTAMP", async () => {
    const r = await isEligibleForTTL({
      ...aMessageStatus,
      _ts: 2670524345,
      status: RejectedMessageStatusValueEnum.REJECTED
    })();
    expect(E.isLeft(r)).toBeTruthy();
    if (E.isLeft(r)) {
      expect(r.left).toBe(
        `the timestamp of the document ${
          aMessageStatus.id
        } (${2670524345}) is after the RELEASE_TIMESTAMP ${RELEASE_TIMESTAMP}`
      );
    }
  });

  it("should return a string if the document already has a ttl", async () => {
    const r = await isEligibleForTTL({
      ...aMessageStatus,
      status: RejectedMessageStatusValueEnum.REJECTED,
      ttl
    })();
    expect(E.isLeft(r)).toBeTruthy();
    if (E.isLeft(r)) {
      expect(r.left).toBe(
        `the document ${aMessageStatus.id} has a ttl already`
      );
    }
  });

  it("should return the retrieved document if it is eligible", async () => {
    const r = await isEligibleForTTL(anEligibleDocument)();
    expect(E.isRight(r)).toBeTruthy();
    if (E.isRight(r)) {
      expect(r.right).toBe(anEligibleDocument);
    }
  });
});

describe("handleSetTTL", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("should call the findLastVersionByModelId 4 times but never set the ttl", async () => {
    /*
     * In this scenario we are passing 4 eligible documents so we expect the mockProfileFindLast to have been called 4 times
     * but the ttl should never be setted cause by default mockProfileFindLast return a Some meaning that the user exist.
     * */

    const r = await handleSetTTL(
      mockMessageStatusModel,
      mockMessageModel,
      mockProfileModel,
      mockContext,
      mockDocuments
    )();
    expect(E.isLeft(r)).toBeTruthy();
    expect(mockProfileFindLast).toHaveBeenCalledTimes(4);
    expect(mockUpdateTTLForAllVersions).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
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
      mockContext,
      mockDocuments
    )();
    expect(E.isLeft(r)).toBeTruthy();
    expect(mockProfileFindLast).toHaveBeenCalledTimes(4);
    expect(mockUpdateTTLForAllVersions).toHaveBeenCalledTimes(4);
    expect(mockPatch).toHaveBeenCalledTimes(4);
  });
});
