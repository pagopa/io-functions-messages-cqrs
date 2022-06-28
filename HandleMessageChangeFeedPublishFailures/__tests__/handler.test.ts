import { Context } from "@azure/functions";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";
import { TelemetryClient } from "../../utils/appinsights";
import { avroMessageFormatter } from "../../utils/formatter/messagesAvroFormatter";
import {
  aMessageContent,
  aRetrievedMessageWithoutContent
} from "../../__mocks__/message";
import {
  HandleMessageChangeFeedPublishFailureHandler,
  HandleMessagePublishFailureInput
} from "../handler";

const functionsContextMock = ({
  bindings: {},
  done: jest.fn(),
  log: {
    error: jest.fn()
  }
} as unknown) as Context;

const telemetryClientMock = ({
  trackException: jest.fn(_ => void 0)
} as unknown) as TelemetryClient;

const getContentFromBlobMock = jest
  .fn()
  .mockImplementation(() => TE.of(O.some(aMessageContent)));

const mockMessageModel = ({
  getContentFromBlob: getContentFromBlobMock
} as any) as MessageModel;

const inputMessage = {
  body: {
    ...aRetrievedMessageWithoutContent,
    kind: "IRetrievedMessageWithoutContent" as const
  }
};

const aRetriableInput: HandleMessagePublishFailureInput = {
  ...inputMessage,
  retriable: true
};

const aNotRetriableInput: HandleMessagePublishFailureInput = {
  ...inputMessage,
  retriable: false
};

const anyParam = {} as any;

describe("HandleMessageChangeFeedPublishFailureHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shoud write an avro message on message bindings", async () => {
    const res = await HandleMessageChangeFeedPublishFailureHandler(
      functionsContextMock,
      aRetriableInput,
      telemetryClientMock,
      mockMessageModel,
      anyParam
    );
    expect(res).toEqual(void 0);
    expect(telemetryClientMock.trackException).not.toHaveBeenCalled();
    expect(functionsContextMock.bindings.messages).toEqual(
      JSON.stringify(
        avroMessageFormatter()({
          ...inputMessage.body,
          content: aMessageContent,
          kind: "IRetrievedMessageWithContent"
        })
      )
    );
  });
  it("shoud return void if everything works fine", async () => {
    await expect(
      HandleMessageChangeFeedPublishFailureHandler(
        functionsContextMock,
        aRetriableInput,
        telemetryClientMock,
        mockMessageModel,
        anyParam
      )
    ).resolves.toEqual(void 0);
    expect(telemetryClientMock.trackException).not.toHaveBeenCalled();
  });

  it("shoud throw if Transient failure occurs", async () => {
    getContentFromBlobMock.mockImplementationOnce(() =>
      TE.left("Cannot enrich message content")
    );
    await expect(
      HandleMessageChangeFeedPublishFailureHandler(
        functionsContextMock,
        aRetriableInput,
        telemetryClientMock,
        mockMessageModel,
        anyParam
      )
    ).rejects.toBeDefined();
    expect(telemetryClientMock.trackException).toHaveBeenCalledWith(
      expect.objectContaining({
        tagOverrides: { samplingEnabled: "true" }
      })
    );
  });

  it("shoud return a Permanent failure if input decode fails", async () => {
    await expect(
      HandleMessageChangeFeedPublishFailureHandler(
        functionsContextMock,
        { wrongInput: true },
        telemetryClientMock,
        mockMessageModel,
        anyParam
      )
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "PERMANENT"
      })
    );
    expect(telemetryClientMock.trackException).toHaveBeenCalled();
  });

  it("shoud return a Permanent failure if input is not retriable", async () => {
    await expect(
      HandleMessageChangeFeedPublishFailureHandler(
        functionsContextMock,
        aNotRetriableInput,
        telemetryClientMock,
        mockMessageModel,
        anyParam
      )
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "PERMANENT"
      })
    );
    expect(telemetryClientMock.trackException).toHaveBeenCalled();
  });
});
