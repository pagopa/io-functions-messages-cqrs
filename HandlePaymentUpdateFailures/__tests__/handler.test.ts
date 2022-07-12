import { Context } from "@azure/functions";
import { PaymentNoticeNumber } from "@pagopa/io-functions-commons/dist/generated/definitions/PaymentNoticeNumber";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import * as TE from "fp-ts/lib/TaskEither";
import * as t from "io-ts";
import { PaymentUpdaterClient } from "../../clients/payment-updater";
import { ApiPaymentMessage } from "../../generated/payment-updater/ApiPaymentMessage";
import { TelemetryClient } from "../../utils/appinsights";
import { TransientFailure } from "../../utils/errors";
import * as util from "../../utils/message_view";
import { PaymentUpdate } from "../../utils/message_view";
import { aFiscalCode, aMessageStatus } from "../../__mocks__/message";
import {
  HandlePaymentUpdateFailureHandler,
  HandlePaymentUpdateFailureInput
} from "../handler";

const functionsContextMock = ({
  log: {
    error: jest.fn()
  }
} as unknown) as Context;

const telemetryClientMock = ({
  trackException: jest.fn(_ => void 0)
} as unknown) as TelemetryClient;

const handlePaymentChangeUtilityMock = jest
  .fn()
  .mockImplementation(() => TE.of(void 0));
jest
  .spyOn(util, "handlePaymentChange")
  .mockImplementation(() => handlePaymentChangeUtilityMock);

const aPaymentUpdate: PaymentUpdate = {
  fiscalCode: aFiscalCode,
  messageId: aMessageStatus.messageId,
  paid: true,
  noticeNumber: "011111111111111111" as PaymentNoticeNumber
};

const inputMessage = {
  body: {
    ...aPaymentUpdate
  },
  message: "aMessage"
};

const aRetriableInput: HandlePaymentUpdateFailureInput = {
  ...inputMessage,
  retriable: true
};

const aNotRetriableInput: HandlePaymentUpdateFailureInput = {
  ...inputMessage,
  retriable: false
};

const aTransientFailure: TransientFailure = {
  kind: "TRANSIENT",
  reason: "aReason"
};
const anyParam = {} as any;

const aPaymentStatus: ApiPaymentMessage = {
  paid: true,
  fiscalCode: aFiscalCode.toString() as NonEmptyString,
  messageId: aMessageStatus.messageId,
  noticeNumber: "011111111111111111" as NonEmptyString
};

const aSuccessPaymentUpdateResponse = {
  status: 200,
  value: aPaymentStatus
};

const getPaymentUpdateMock = jest
  .fn()
  .mockImplementation(() =>
    Promise.resolve(t.success(aSuccessPaymentUpdateResponse))
  );
const paymentUpdaterApiClientMock = {
  getMessagePayment: getPaymentUpdateMock
} as PaymentUpdaterClient;

describe("HandlePaymentUpdateFailureHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it("shoud return void if everything works fine", async () => {
    await expect(
      HandlePaymentUpdateFailureHandler(
        functionsContextMock,
        aRetriableInput,
        telemetryClientMock,
        anyParam,
        paymentUpdaterApiClientMock
      )
    ).resolves.toEqual(void 0);
    expect(telemetryClientMock.trackException).not.toHaveBeenCalled();
  });

  it("shoud throw if a retriable status code is returned while calling getPaymentUpdate API", async () => {
    getPaymentUpdateMock.mockImplementationOnce(() =>
      Promise.resolve(
        t.success({
          status: 404
        })
      )
    );
    await expect(
      HandlePaymentUpdateFailureHandler(
        functionsContextMock,
        aRetriableInput,
        telemetryClientMock,
        anyParam,
        paymentUpdaterApiClientMock
      )
    ).rejects.toBeDefined();
    expect(handlePaymentChangeUtilityMock).not.toHaveBeenCalled();
    expect(telemetryClientMock.trackException).toHaveBeenCalledWith(
      expect.objectContaining({
        tagOverrides: { samplingEnabled: "true" }
      })
    );
  });

  it("shoud throw if Transient failure occurs while handling message view update", async () => {
    handlePaymentChangeUtilityMock.mockImplementationOnce(() =>
      TE.left(aTransientFailure)
    );
    await expect(
      HandlePaymentUpdateFailureHandler(
        functionsContextMock,
        aRetriableInput,
        telemetryClientMock,
        anyParam,
        paymentUpdaterApiClientMock
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
      HandlePaymentUpdateFailureHandler(
        functionsContextMock,
        { wrongInput: true },
        telemetryClientMock,
        anyParam,
        paymentUpdaterApiClientMock
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
      HandlePaymentUpdateFailureHandler(
        functionsContextMock,
        aNotRetriableInput,
        telemetryClientMock,
        anyParam,
        paymentUpdaterApiClientMock
      )
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "PERMANENT"
      })
    );
    expect(telemetryClientMock.trackException).toHaveBeenCalled();
  });

  it("shoud return a Permanent failure if getPaymentUpdate API returns a not retriable status code", async () => {
    getPaymentUpdateMock.mockImplementationOnce(() =>
      Promise.resolve(
        t.success({
          status: 401
        })
      )
    );
    await expect(
      HandlePaymentUpdateFailureHandler(
        functionsContextMock,
        aNotRetriableInput,
        telemetryClientMock,
        anyParam,
        paymentUpdaterApiClientMock
      )
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "PERMANENT"
      })
    );
    expect(telemetryClientMock.trackException).toHaveBeenCalled();
  });

  it("shoud return a Permanent failure if handlePaymentChange returns a Permanent Failure", async () => {
    handlePaymentChangeUtilityMock.mockImplementationOnce(() =>
      TE.left({ ...aTransientFailure, kind: "PERMANENT" })
    );
    await expect(
      HandlePaymentUpdateFailureHandler(
        functionsContextMock,
        aNotRetriableInput,
        telemetryClientMock,
        anyParam,
        paymentUpdaterApiClientMock
      )
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "PERMANENT"
      })
    );
    expect(telemetryClientMock.trackException).toHaveBeenCalled();
  });
});
