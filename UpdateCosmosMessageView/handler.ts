/* eslint-disable max-params */
import { MessageViewModel } from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { pipe, flow } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { BlobService } from "azure-storage";
import { QueueClient, QueueSendMessageResponse } from "@azure/storage-queue";
import { TelemetryClient } from "../utils/appinsights";
import {
  handleStatusChange,
  RetrievedMessageStatusWithFiscalCode
} from "../utils/message_view";
import { Failure, toPermanentFailure, TransientFailure } from "../utils/errors";
import { errorsToError } from "../utils/conversions";

interface IStorableError<T> extends Error {
  readonly body: T;
  readonly retriable: boolean;
}

export const storeError = (queueClient: QueueClient) => (
  storableError: IStorableError<unknown>
): TE.TaskEither<Error, QueueSendMessageResponse> =>
  TE.tryCatch(
    () => queueClient.sendMessage(JSON.stringify(storableError)),
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
  telemetryClient: TelemetryClient
) => (processingError: IStorableError<T>): TE.TaskEither<void, void> =>
  pipe(
    processingError,
    storeError(queueClient),
    TE.mapLeft(storingError =>
      telemetryClient.trackEvent({
        name: "trigger.elt.updatemessageview.failedwithoutstoringerror",
        properties: {
          processingError: JSON.stringify(processingError),
          storingError: storingError.message
        },
        tagOverrides: { samplingEnabled: "false" }
      })
    ),
    TE.map(() =>
      telemetryClient.trackEvent({
        name: "trigger.elt.updatemessageview.failed",
        properties: {
          processingError: JSON.stringify(processingError)
        },
        tagOverrides: { samplingEnabled: "false" }
      })
    )
  );

export const storeAndLogErrorFirst = <T>(
  queueClient: QueueClient,
  telemetryClient: TelemetryClient
) => (error: IStorableError<T>): TE.TaskEither<IStorableError<T>, void> =>
  pipe(
    error,
    storeAndLogError(queueClient, telemetryClient),
    TE.mapLeft(() => error)
  );

export const handle = (
  telemetryClient: TelemetryClient,
  messageViewModel: MessageViewModel,
  messageModel: MessageModel,
  queueClient: QueueClient,
  blobService: BlobService,
  rawMessageStatus: unknown
): Promise<IStorableError<unknown> | void> =>
  pipe(
    rawMessageStatus,
    RetrievedMessageStatusWithFiscalCode.decode,
    TE.fromEither,
    TE.mapLeft(flow(errorsToError, toPermanentFailure)),
    TE.chain(handleStatusChange(messageViewModel, messageModel, blobService)),
    TE.mapLeft(toStorableError(rawMessageStatus)),
    TE.orElseFirst(storeAndLogErrorFirst(queueClient, telemetryClient)),
    TE.toUnion
  )();
