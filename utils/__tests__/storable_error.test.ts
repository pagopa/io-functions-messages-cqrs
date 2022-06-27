import * as E from "fp-ts/Either";
import { storeAndLogError } from "../storable_error";

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
      mockAppinsights as any,
      ""
    )(dummyStorableError)();

    expect(E.isRight(result)).toBeTruthy();
    expect(mockQueueClient.sendMessage).toBeCalledWith(
      Buffer.from(
        JSON.stringify({
          ...dummyStorableError,
          body: dummyStorableError.body
        })
      ).toString("base64")
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
      mockAppinsights as any,
      ""
    )(dummyStorableError)();

    expect(E.isLeft(result)).toBeTruthy();
    expect(mockQueueClient.sendMessage).toBeCalledWith(
      Buffer.from(
        JSON.stringify({
          ...dummyStorableError,
          body: dummyStorableError.body
        })
      ).toString("base64")
    );
    expect(mockAppinsights.trackEvent).toBeCalledWith(
      expect.objectContaining({
        name:
          "trigger.messages.cqrs.updatemessageview.failedwithoutstoringerror"
      })
    );
  });
});
