import * as t from "io-ts";

import * as E from "fp-ts/lib/Either";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";

import * as KP from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import {
  MessageModel,
  RetrievedMessage
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { pipe } from "fp-ts/lib/function";
import {
  aMessageContent,
  aRetrievedMessageWithoutContent
} from "../../__mocks__/message";
import { handleMessageChange } from "../handler";

// ----------------------
// Variables
// ----------------------

const topic = "aTopic";

const aListOfRightMessages = pipe(
  Array.from({ length: 10 }, i => aRetrievedMessageWithoutContent),
  t.array(RetrievedMessage).decode,
  E.getOrElseW(() => {
    throw Error();
  })
);

// ----------------------
// Mocks
// ----------------------

const mockAppinsights = {
  trackEvent: jest.fn().mockReturnValue(void 0)
} as any;

const mockQueueClient = {
  sendMessage: jest.fn().mockImplementation(() => Promise.resolve(void 0))
} as any;

const getContentFromBlobMock = jest
  .fn()
  .mockImplementation(() => TE.of(O.some(aMessageContent)));

const mockMessageModel = ({
  getContentFromBlob: getContentFromBlobMock
} as any) as MessageModel;

const mockKafkaProducerKompact: KP.KafkaProducerCompact<RetrievedMessage> = () => ({
  producer: {} as any,
  topic: { topic }
});

const kafkaSendMessagesMock = jest.fn().mockImplementation(TE.of);
jest.spyOn(KP, "sendMessages").mockImplementation(_ => kafkaSendMessagesMock);

// ----------------------
// Tests
// ----------------------

describe("CosmosApiMessagesChangeFeed", () => {
  beforeEach(() => jest.clearAllMocks());
  it("should send all retrieved messages", async () => {
    const handler = handleMessageChange(mockMessageModel, {} as any);

    const res = await handler(
      mockKafkaProducerKompact,
      mockQueueClient,
      mockAppinsights,
      "",
      aListOfRightMessages
    );

    expect(mockMessageModel.getContentFromBlob).toHaveBeenCalledTimes(
      aListOfRightMessages.length
    );

    expect(mockQueueClient.sendMessage).not.toHaveBeenCalled();
    expect(res).toMatchObject(
      expect.objectContaining({
        results: `Documents sent (${aListOfRightMessages.length}).`
      })
    );
  });

  it("should call sendMessages with empty array of all messages are pending", async () => {
    const handler = handleMessageChange(mockMessageModel, {} as any);

    const res = await handler(
      mockKafkaProducerKompact,
      mockQueueClient,
      mockAppinsights,
      "",
      aListOfRightMessages.map(m => ({
        ...m,
        isPending: true
      }))
    );

    expect(mockMessageModel.getContentFromBlob).not.toHaveBeenCalled();

    expect(mockQueueClient.sendMessage).not.toHaveBeenCalled();
    expect(res).toMatchObject(
      expect.objectContaining({
        results: `Documents sent (${aListOfRightMessages.length}).`
      })
    );
  });

  it("should send only non pending messages", async () => {
    const handler = handleMessageChange(mockMessageModel, {} as any);

    const res = await handler(
      mockKafkaProducerKompact,
      mockQueueClient,
      mockAppinsights,
      "",
      [
        ...aListOfRightMessages,
        { ...aRetrievedMessageWithoutContent, isPending: true }
      ]
    );

    expect(mockMessageModel.getContentFromBlob).toHaveBeenCalledTimes(
      aListOfRightMessages.length
    );

    expect(mockQueueClient.sendMessage).not.toHaveBeenCalled();
    expect(res).toMatchObject(
      expect.objectContaining({
        results: `Documents sent (${aListOfRightMessages.length}).`
      })
    );
  });
});

describe("CosmosApiMessagesChangeFeed - Errors", () => {
  beforeEach(() => jest.clearAllMocks());
  it.each`
    getContentResult
    ${TE.left(Error("An error occurred"))}
    ${TE.of(O.none)}
  `(
    "should store error if a content cannot be retrieved",
    async ({ getContentResult }) => {
      getContentFromBlobMock.mockImplementationOnce(() => getContentResult);

      const handler = handleMessageChange(mockMessageModel, {} as any);

      const res = await handler(
        mockKafkaProducerKompact,
        mockQueueClient,
        mockAppinsights,
        "",
        aListOfRightMessages
      );

      expect(mockMessageModel.getContentFromBlob).toHaveBeenCalledTimes(
        aListOfRightMessages.length
      );

      expect(mockQueueClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject(
        expect.objectContaining({
          errors: `Processed (1) errors`,
          results: `Documents sent (${aListOfRightMessages.length - 1}).`
        })
      );
    }
  );

  it("should send only decoded retrieved messages", async () => {
    const handler = handleMessageChange(mockMessageModel, {} as any);

    const res = await handler(
      mockKafkaProducerKompact,
      mockQueueClient,
      mockAppinsights,
      "",
      [...aListOfRightMessages, { error: "error" }]
    );

    expect(mockMessageModel.getContentFromBlob).toHaveBeenCalledTimes(
      aListOfRightMessages.length
    );

    expect(mockQueueClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject(
      expect.objectContaining({
        errors: `Processed (1) errors`,
        results: `Documents sent (${aListOfRightMessages.length}).`
      })
    );
  });
});
