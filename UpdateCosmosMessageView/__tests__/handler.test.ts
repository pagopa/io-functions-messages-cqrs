import { handle, storeAndLogError } from "../handler";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import * as mw from "../../utils/message_view";
import { aMessageStatus } from "../../__mocks__/message";
import { toPermanentFailure, TransientFailure } from "../../utils/errors";
import { MessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/MessageStatusValue";

const dummyDocument = {
  test: "test value"
};

const dummyStorableError = {
  name: "Storable Error",
  body: dummyDocument,
  message: "error message",
  retriable: true
};

const mockAppinsights = {
  trackEvent: jest.fn().mockReturnValue(void 0)
};

const mockQueueClient = {
  sendMessage: jest.fn().mockImplementation(() => Promise.resolve(void 0))
};

const handleStatusChangeUtilityMock = jest
  .fn()
  .mockImplementation(() => TE.of(void 0));
jest
  .spyOn(mw, "handleStatusChange")
  .mockImplementation(() => handleStatusChangeUtilityMock);

const anyParam = {} as any;

const aTransientFailure: TransientFailure = {
  kind: "TRANSIENT",
  reason: "aReason"
};

describe("storeAndLogError", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GIVEN a working table storage client WHEN an error is stored THEN a new entity in the table is created and an event is tracked", async () => {
    mockQueueClient.sendMessage.mockImplementationOnce(() =>
      Promise.resolve(true)
    );
    const result = await storeAndLogError(
      mockQueueClient as any,
      mockAppinsights as any
    )(dummyStorableError)();

    expect(E.isRight(result)).toBeTruthy();
    expect(mockQueueClient.sendMessage).toBeCalledWith(
      JSON.stringify({
        ...dummyStorableError,
        body: dummyStorableError.body
      })
    );
    expect(mockAppinsights.trackEvent).toBeCalledWith(
      expect.objectContaining({
        name: "trigger.messages.cqrs.updatemessageview.failed"
      })
    );
  });

  it("GIVEN a not wroking table storage client WHEN an error is stored THEN no entities are created and an event is tracked", async () => {
    mockQueueClient.sendMessage.mockImplementationOnce(() =>
      Promise.reject(new Error("createEntity failed"))
    );
    const result = await storeAndLogError(
      mockQueueClient as any,
      mockAppinsights as any
    )(dummyStorableError)();

    expect(E.isLeft(result)).toBeTruthy();
    expect(mockQueueClient.sendMessage).toBeCalledWith(
      JSON.stringify({
        ...dummyStorableError,
        body: dummyStorableError.body
      })
    );
    expect(mockAppinsights.trackEvent).toBeCalledWith(
      expect.objectContaining({
        name:
          "trigger.messages.cqrs.updatemessageview.failedwithoutstoringerror"
      })
    );
  });
});

describe("handle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GIVEN a malformed messageStatus WHEN decoding input THEN it should return a not retriable Error", async () => {
    const result = await handle(
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      anyParam,
      anyParam,
      { ...aMessageStatus, fiscalCode: undefined }
    );

    expect(mockQueueClient.sendMessage).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trigger.messages.cqrs.updatemessageview.failed"
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        body: { ...aMessageStatus, fiscalCode: undefined },
        retriable: false
      })
    );
  });

  it("GIVEN a messageStatus WHEN handleStatusChange returns a transient failure THEN it should return a retriable Error", async () => {
    handleStatusChangeUtilityMock.mockImplementationOnce(() =>
      TE.left(aTransientFailure)
    );
    const result = await handle(
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      anyParam,
      anyParam,
      aMessageStatus
    );

    expect(mockQueueClient.sendMessage).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trigger.messages.cqrs.updatemessageview.failed"
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        body: aMessageStatus,
        retriable: true
      })
    );
  });

  it("GIVEN a messageStatus WHEN handleStatusChange returns a permanent failure THEN it should return a not retriable Error", async () => {
    handleStatusChangeUtilityMock.mockImplementationOnce(() =>
      TE.left(toPermanentFailure(Error("PERMANENT")))
    );
    const result = await handle(
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      anyParam,
      anyParam,
      aMessageStatus
    );

    expect(mockQueueClient.sendMessage).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trigger.messages.cqrs.updatemessageview.failed"
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        body: aMessageStatus,
        retriable: false
      })
    );
  });

  it("GIVEN a messageStatus WHEN handleStatusChange returns void THEN it should return void without store any error", async () => {
    const result = await handle(
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      anyParam,
      anyParam,
      aMessageStatus
    );

    expect(mockQueueClient.sendMessage).not.toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).not.toHaveBeenCalled();
    expect(result).toEqual(void 0);
  });

  it("GIVEN a messageStatus WHEN status is not PROCESSED THEN it should return void without store any error", async () => {
    const result = await handle(
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      anyParam,
      anyParam,
      { ...aMessageStatus, status: MessageStatusValueEnum.FAILED }
    );

    expect(mockQueueClient.sendMessage).not.toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).not.toHaveBeenCalled();
    expect(result).toEqual(void 0);
  });
});
