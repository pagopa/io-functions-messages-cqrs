import { Context } from "@azure/functions";
import { PaymentNoticeNumber } from "@pagopa/io-functions-commons/dist/generated/definitions/PaymentNoticeNumber";
import * as TE from "fp-ts/TaskEither";
import { toPermanentFailure, TransientFailure } from "../../utils/errors";
import * as mw from "../../utils/message_view";
import { PaymentUpdate } from "../../utils/message_view";
import { aMessageView } from "../../__mocks__/message";
import { handle } from "../handler";

const getFunctionContextWithRetryContext = (
  retryCount: number = 1,
  maxRetryCount: number = 10
) =>
  (({
    log: {
      error: jest.fn()
    },
    executionContext: {
      retryContext: {
        retryCount,
        maxRetryCount
      }
    }
  } as unknown) as Context);

const mockAppinsights = {
  trackEvent: jest.fn().mockReturnValue(void 0),
  trackException: jest.fn().mockReturnValue(void 0)
};

const mockQueueClient = {
  sendMessage: jest.fn().mockImplementation(() => Promise.resolve(void 0))
};

const handlePaymentChangeUtilityMock = jest
  .fn()
  .mockImplementation(() => TE.of(void 0));
jest
  .spyOn(mw, "handlePaymentChange")
  .mockImplementation(() => handlePaymentChangeUtilityMock);

const anyParam = {} as any;

const aTransientFailure: TransientFailure = {
  kind: "TRANSIENT",
  reason: "aReason"
};

const aPaymentUpdate: PaymentUpdate = {
  fiscalCode: aMessageView.fiscalCode,
  messageId: aMessageView.id,
  paid: true,
  noticeNumber: "011111111111111111" as PaymentNoticeNumber
};

describe("handle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GIVEN a malformed payment update WHEN decoding input THEN it should return a not retriable Error", async () => {
    const result = await handle(
      getFunctionContextWithRetryContext(),
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      { fiscalCode: undefined }
    );

    expect(mockQueueClient.sendMessage).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trigger.messages.cqrs.updatepaymentmessageview.failed"
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        body: { fiscalCode: undefined },
        retriable: false
      })
    );
  });

  it("GIVEN a payment update WHEN handlePaymentChange returns a transient failure and retry count has reached retry cap count THEN it should return a retriable Error", async () => {
    handlePaymentChangeUtilityMock.mockImplementationOnce(() =>
      TE.left(aTransientFailure)
    );

    const result = await handle(
      getFunctionContextWithRetryContext(5, 10),
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      aPaymentUpdate
    );

    expect(mockQueueClient.sendMessage).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trigger.messages.cqrs.updatepaymentmessageview.failed"
      })
    );

    console.log(result);
    expect(result).toEqual(
      expect.objectContaining({
        body: aPaymentUpdate,
        retriable: true
      })
    );
  });

  it("GIVEN a payment update WHEN handlePaymentChange returns a transient failure and retry count has not reached retry cap count THEN it should throw an Error", async () => {
    handlePaymentChangeUtilityMock.mockImplementationOnce(() =>
      TE.left(aTransientFailure)
    );

    await expect(
      handle(
        getFunctionContextWithRetryContext(),
        mockAppinsights as any,
        mockQueueClient as any,
        anyParam,
        aPaymentUpdate
      )
    ).rejects.toBeDefined();

    expect(mockQueueClient.sendMessage).not.toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).not.toHaveBeenCalled();
    expect(mockAppinsights.trackException).toHaveBeenCalled();

    expect(mockAppinsights.trackException).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: {
          detail: "TRANSIENT",
          fatal: "false",
          isSuccess: "false",
          modelId: "",
          name: "message.view.paymentupdate.failure"
        }
      })
    );
  });

  it("GIVEN a payment update WHEN handlePaymentChange returns a permanent failure THEN it should return a not retriable Error", async () => {
    handlePaymentChangeUtilityMock.mockImplementationOnce(() =>
      TE.left(toPermanentFailure(Error("PERMANENT")))
    );
    const result = await handle(
      getFunctionContextWithRetryContext(),
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      aPaymentUpdate
    );

    expect(mockQueueClient.sendMessage).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trigger.messages.cqrs.updatepaymentmessageview.failed"
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        body: aPaymentUpdate,
        retriable: false
      })
    );
  });

  it("GIVEN a payment update WHEN handlePaymentChange returns void THEN it should return void without store any error", async () => {
    const result = await handle(
      getFunctionContextWithRetryContext(),
      mockAppinsights as any,
      mockQueueClient as any,
      anyParam,
      aPaymentUpdate
    );

    expect(mockQueueClient.sendMessage).not.toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).not.toHaveBeenCalled();
    expect(result).toEqual(void 0);
  });

  it("GIVEN a payment update WHEN handlePaymentChange returns a transient failure and error queue storage is not working THEN it should throw an error", async () => {
    handlePaymentChangeUtilityMock.mockImplementationOnce(() =>
      TE.left(aTransientFailure)
    );
    const aCreationError = new Error("createEntity failed");
    mockQueueClient.sendMessage.mockImplementationOnce(() =>
      Promise.reject(aCreationError)
    );

    await expect(
      handle(
        getFunctionContextWithRetryContext(10, 10),
        mockAppinsights as any,
        mockQueueClient as any,
        anyParam,
        aPaymentUpdate
      )
    ).rejects.toBeDefined();

    expect(mockQueueClient.sendMessage).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalled();
    expect(mockAppinsights.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name:
          "trigger.messages.cqrs.updatepaymentmessageview.failedwithoutstoringerror"
      })
    );
  });
});
