import { QueueClient, QueueSendMessageResponse } from "@azure/storage-queue";
import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/TaskEither";
import { TelemetryClient } from "../utils/appinsights";
import { Failure, TransientFailure } from "../utils/errors";

export interface IStorableError<T> extends Error {
  readonly body: T;
  readonly retriable: boolean;
}

export const storeError = (queueClient: QueueClient) => (
  storableError: IStorableError<unknown>
): TE.TaskEither<Error, QueueSendMessageResponse> =>
  TE.tryCatch(
    () =>
      queueClient.sendMessage(
        Buffer.from(JSON.stringify(storableError)).toString("base64")
      ),
    E.toError
  );

export const toStorableError = <T>(body: T) => (
  error: Failure
): IStorableError<T> => ({
  body,
  message: error.reason,
  name: "Storable Error",
  retriable: TransientFailure.is(error)
});

export const storeAndLogError = <T>(
  queueClient: QueueClient,
  telemetryClient: TelemetryClient,
  cqrsLogName: string
) => (
  processingError: IStorableError<T | unknown>
): TE.TaskEither<Error, void> =>
  pipe(
    processingError,
    storeError(queueClient),
    TE.mapLeft(storingError =>
      pipe(
        telemetryClient.trackEvent({
          name: `trigger.messages.cqrs.${cqrsLogName}.failedwithoutstoringerror`,
          properties: {
            processingError: JSON.stringify(processingError),
            storingError: storingError.message
          },
          tagOverrides: { samplingEnabled: "false" }
        }),
        () => storingError
      )
    ),
    TE.map(() =>
      telemetryClient.trackEvent({
        name: `trigger.messages.cqrs.${cqrsLogName}.failed`,
        properties: {
          processingError: JSON.stringify(processingError)
        },
        tagOverrides: { samplingEnabled: "false" }
      })
    )
  );

export const storeAndLogErrorOrThrow = <T>(
  queueClient: QueueClient,
  telemetryClient: TelemetryClient,
  cqrsLogName: string
) => (
  error: IStorableError<T | unknown>
): TE.TaskEither<IStorableError<T | unknown>, void> =>
  pipe(
    error,
    storeAndLogError(queueClient, telemetryClient, cqrsLogName),
    TE.mapLeft(e => {
      throw e;
    })
  );
