/* eslint-disable max-params */
import { MessageViewModel } from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { pipe, flow, identity, constVoid } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { BlobService } from "azure-storage";
import { QueueClient, QueueSendMessageResponse } from "@azure/storage-queue";
import { MessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/MessageStatusValue";
import { TelemetryClient } from "../utils/appinsights";
import {
  handleStatusChange,
  RetrievedMessageStatusWithFiscalCode
} from "../utils/message_view";
import { Failure, toPermanentFailure, TransientFailure } from "../utils/errors";
import { errorsToError } from "../utils/conversions";

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
  telemetryClient: TelemetryClient
) => (processingError: IStorableError<T>): TE.TaskEither<Error, void> =>
  pipe(
    processingError,
    storeError(queueClient),
    TE.mapLeft(storingError =>
      pipe(
        telemetryClient.trackEvent({
          name:
            "trigger.messages.cqrs.updatemessageview.failedwithoutstoringerror",
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
        name: "trigger.messages.cqrs.updatemessageview.failed",
        properties: {
          processingError: JSON.stringify(processingError)
        },
        tagOverrides: { samplingEnabled: "false" }
      })
    )
  );

export const storeAndLogErrorOrThrow = <T>(
  queueClient: QueueClient,
  telemetryClient: TelemetryClient
) => (error: IStorableError<T>): TE.TaskEither<IStorableError<T>, void> =>
  pipe(
    TE.right(error),
    TE.chainFirst(storeAndLogError(queueClient, telemetryClient)),
    TE.mapLeft(e => {
      throw e;
    }),
    TE.swap
  );

export const handle = (
  telemetryClient: TelemetryClient,
  queueClient: QueueClient,
  messageViewModel: MessageViewModel,
  messageModel: MessageModel,
  blobService: BlobService,
  rawMessageStatus: unknown
): Promise<IStorableError<unknown> | void> =>
  pipe(
    rawMessageStatus,
    RetrievedMessageStatusWithFiscalCode.decode,
    TE.fromEither,
    TE.mapLeft(flow(errorsToError, e => toPermanentFailure(e)())),
    TE.chain(
      flow(
        // skip Message Statuses that are not PROCESSED
        TE.fromPredicate(
          messageStatusWithFiscalCode =>
            messageStatusWithFiscalCode.status !==
            MessageStatusValueEnum.PROCESSED,
          identity
        ),
        TE.orElseW(
          handleStatusChange(messageViewModel, messageModel, blobService)
        )
      )
    ),
    TE.mapLeft(toStorableError(rawMessageStatus)),
    TE.orElseFirst(storeAndLogErrorOrThrow(queueClient, telemetryClient)),
    TE.map(constVoid),
    TE.toUnion
  )();
