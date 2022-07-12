import { Context } from "@azure/functions";
import { MessageViewModel } from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { IResponseType } from "@pagopa/ts-commons/lib/requests";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import * as E from "fp-ts/lib/Either";
import { constVoid, flow, pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import * as t from "io-ts";
import { PaymentUpdaterClient } from "../clients/payment-updater";
import { ApiPaymentMessage } from "../generated/payment-updater/ApiPaymentMessage";
import { TelemetryClient, trackException } from "../utils/appinsights";
import { errorsToError } from "../utils/conversions";
import {
  Failure,
  PermanentFailure,
  toPermanentFailure,
  toTransientFailure,
  TransientFailure
} from "../utils/errors";
import { handlePaymentChange, PaymentUpdate } from "../utils/message_view";

const RetriableHandlePaymentUpdateFailureInput = t.interface({
  body: PaymentUpdate,
  retriable: t.literal(true)
});

type RetriableHandlePaymentUpdateFailureInput = t.TypeOf<
  typeof RetriableHandlePaymentUpdateFailureInput
>;
export const HandlePaymentUpdateFailureInput = t.intersection([
  t.union([
    RetriableHandlePaymentUpdateFailureInput,
    t.interface({
      retriable: t.literal(false)
    })
  ]),
  t.interface({
    message: t.string
  })
]);
export type HandlePaymentUpdateFailureInput = t.TypeOf<
  typeof HandlePaymentUpdateFailureInput
>;

const isGetPaymentUpdateSuccess = (
  res: IResponseType<number, unknown, never>
): res is IResponseType<200, ApiPaymentMessage, never> => res.status === 200;
const retriableStatusCodes = [404, 500, 503];

const retrievePaymentUpdate = (
  paymentUpdaterApiClient: PaymentUpdaterClient,
  messageId: NonEmptyString
): TE.TaskEither<Failure, PaymentUpdate> =>
  pipe(
    TE.tryCatch(
      () => paymentUpdaterApiClient.getMessagePayment({ messageId }),
      E.toError
    ),
    TE.chain(flow(TE.fromEither, TE.mapLeft(errorsToError))),
    TE.mapLeft(err => toTransientFailure(err)(messageId)),
    TE.chain(
      TE.fromPredicate(isGetPaymentUpdateSuccess, res =>
        retriableStatusCodes.includes(res.status)
          ? toTransientFailure(
              Error(`Cannot Get Payment Update| Status is ${res.status}`)
            )()
          : toPermanentFailure(Error("Cannot Permanent Get Payment Update"))()
      )
    ),
    TE.map(response => response.value),
    TE.map(paymentUpdate => ({
      amount: paymentUpdate.amount,
      dueDate: paymentUpdate.dueDate,
      fiscalCode: paymentUpdate.fiscalCode,
      messageId: paymentUpdate.messageId,
      noticeNumber: paymentUpdate.noticeNumber,
      paid: paymentUpdate.paid
    })),
    TE.chainW(
      flow(
        PaymentUpdate.decode,
        E.mapLeft(
          flow(errorsToError, e =>
            toPermanentFailure(
              e,
              "Cannot Decode PaymentUpdate from Payment Updater"
            )()
          )
        ),
        TE.fromEither
      )
    )
  );

export const HandlePaymentUpdateFailureHandler = (
  context: Context,
  message: unknown,
  telemetryClient: TelemetryClient,
  messageViewModel: MessageViewModel,
  paymentUpdaterApiClient: PaymentUpdaterClient
  // eslint-disable-next-line max-params
): Promise<Failure | void> =>
  pipe(
    message,
    HandlePaymentUpdateFailureInput.decode,
    TE.fromEither,
    TE.mapLeft(flow(errorsToError, e => toPermanentFailure(e)())),
    TE.chain(failureInput =>
      pipe(
        failureInput,
        RetriableHandlePaymentUpdateFailureInput.decode,
        TE.fromEither,
        TE.mapLeft(() => toPermanentFailure(Error(failureInput.message))()),
        TE.map(retriableFailure => retriableFailure.body)
      )
    ),
    TE.chain(retriableFailureBody =>
      retrievePaymentUpdate(
        paymentUpdaterApiClient,
        retriableFailureBody.messageId
      )
    ),
    TE.chain(handlePaymentChange(messageViewModel)),
    TE.mapLeft(err => {
      const isTransient = TransientFailure.is(err);
      const error = isTransient
        ? `HandlePaymentUpdateFailure|TRANSIENT_ERROR=${err.reason}`
        : `HandlePaymentUpdateFailure|FATAL|PERMANENT_ERROR=${
            err.reason
          }|INPUT=${JSON.stringify(message)}`;
      trackException(telemetryClient, {
        exception: new Error(error),
        properties: {
          detail: err.kind,
          fatal: PermanentFailure.is(err).toString(),
          isSuccess: "false",
          modelId: err.modelId ?? "",
          name: "message.view.paymentupdate.retry.failure"
        },
        tagOverrides: { samplingEnabled: String(isTransient) }
      });
      context.log.error(error);
      if (isTransient) {
        // Trigger a retry in case of temporary failures
        throw new Error(error);
      }
      return err;
    }),
    TE.map(constVoid),
    TE.toUnion
  )();
