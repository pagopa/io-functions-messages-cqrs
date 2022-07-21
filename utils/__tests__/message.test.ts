import { RetrievedMessage } from "@pagopa/io-functions-commons/dist/src/models/message";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/TaskEither";
import {
  aMessageContent,
  aRetrievedMessageWithoutContent
} from "../../__mocks__/message";

import { enrichMessageContent } from "../message";

const getContentFromBlobMock = jest
  .fn()
  .mockImplementation(() => TE.right(O.some(aMessageContent)));
const mockMessageModel = {
  find: jest.fn(),
  getContentFromBlob: getContentFromBlobMock
};

const mockBlobService = {};

const aRetrievedMessage: RetrievedMessage = {
  ...aRetrievedMessageWithoutContent,
  kind: "IRetrievedMessageWithoutContent"
};

describe("enrichMessageContent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should enrich a message with its' related content", async () => {
    const result = await enrichMessageContent(
      mockMessageModel as any,
      mockBlobService as any,
      aRetrievedMessage
    )();

    expect(E.isRight(result)).toBeTruthy();
    if (E.isRight(result)) {
      expect(result.right).toEqual({
        ...aRetrievedMessage,
        content: aMessageContent,
        kind: "IRetrievedMessageWithContent"
      });
    }
  });

  it("should return a retriable error if blob storage cannot retrieve the message content", async () => {
    getContentFromBlobMock.mockImplementationOnce(() =>
      TE.left(new Error("cannot reach blob storage"))
    );
    const result = await enrichMessageContent(
      mockMessageModel as any,
      mockBlobService as any,
      aRetrievedMessage
    )();

    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual(
        expect.objectContaining({
          retriable: true
        })
      );
    }
  });

  it("should return a not retriable error if message content cannot be found", async () => {
    getContentFromBlobMock.mockImplementationOnce(() => TE.right(O.none));
    const result = await enrichMessageContent(
      mockMessageModel as any,
      mockBlobService as any,
      aRetrievedMessage
    )();

    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual(
        expect.objectContaining({
          retriable: false
        })
      );
    }
  });
});
