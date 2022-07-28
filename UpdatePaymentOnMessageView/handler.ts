/* eslint-disable max-params */
import { Context } from "@azure/functions";
import { QueueClient } from "@azure/storage-queue";
import { MessageViewModel } from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { constVoid, flow, pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/Option";
import * as TE from "fp-ts/TaskEither";
import { TelemetryClient, trackException } from "../utils/appinsights";
import { errorsToError } from "../utils/conversions";
import {
  PermanentFailure,
  toPermanentFailure,
  TransientFailure
} from "../utils/errors";
import { handlePaymentChange, PaymentUpdate } from "../utils/message_view";
import {
  IStorableError,
  storeAndLogErrorOrThrow,
  toStorableError
} from "../utils/storable_error";

const hasReachedRetryCap = (context: Context): boolean =>
  pipe(
    context.executionContext.retryContext,
    O.fromNullable,
    O.map(retryCtx => retryCtx.retryCount < retryCtx.maxRetryCount - 5),
    O.getOrElseW(() => true)
  );

export const handle = (
  context: Context,
  telemetryClient: TelemetryClient,
  queueClient: QueueClient,
  messageViewModel: MessageViewModel,
  rawPaymentUpdate: unknown
): Promise<IStorableError<unknown> | void> =>
  pipe(
    rawPaymentUpdate,
    PaymentUpdate.decode,
    TE.fromEither,
    TE.mapLeft(flow(errorsToError, e => toPermanentFailure(e)())),
    TE.chain(handlePaymentChange(messageViewModel)),
    TE.mapLeft(err => {
      const isTransient = TransientFailure.is(err);
      const error = isTransient
        ? `UpdatePaymentOnMessageView|TRANSIENT_ERROR=${err.reason}`
        : `UpdatePaymentOnMessageView|FATAL|PERMANENT_ERROR=${
            err.reason
          }|INPUT=${JSON.stringify(rawPaymentUpdate)}`;
      trackException(telemetryClient, {
        exception: new Error(error),
        properties: {
          detail: err.kind,
          fatal: PermanentFailure.is(err).toString(),
          isSuccess: "false",
          modelId: err.modelId ?? "",
          name: "message.view.paymentupdate.failure"
        },
        tagOverrides: { samplingEnabled: String(isTransient) }
      });
      context.log.error(error);
      if (isTransient && hasReachedRetryCap(context)) {
        // Trigger a retry in case of temporary failures
        throw new Error(error);
      }

      return toStorableError(rawPaymentUpdate)(err);
    }),
    TE.orElseFirst(
      storeAndLogErrorOrThrow(
        queueClient,
        telemetryClient,
        "updatepaymentmessageview"
      )
    ),
    TE.map(constVoid),
    TE.toUnion
  )();
