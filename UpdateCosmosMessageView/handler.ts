/* eslint-disable max-params */
import {
  MessageView,
  MessageViewModel
} from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { TableClient, TableInsertEntityHeaders } from "@azure/data-tables";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { pipe, identity, flow } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import * as t from "io-ts";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { CosmosErrors } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { BlobService } from "azure-storage";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { TelemetryClient } from "../utils/appinsights";

export const RetrievedMessageStatusWithFiscalCode = t.intersection([
  RetrievedMessageStatus,
  t.interface({ fiscalCode: FiscalCode })
]);
export type RetrievedMessageStatusWithFiscalCode = t.TypeOf<
  typeof RetrievedMessageStatusWithFiscalCode
>;

interface IStorableError<T> extends Error {
  readonly body: T;
  readonly retriable: boolean;
}

export const storeError = (errorStorage: TableClient) => (
  storableError: IStorableError<unknown>
): TE.TaskEither<Error, TableInsertEntityHeaders> =>
  TE.tryCatch(
    () =>
      errorStorage.createEntity({
        body: `${JSON.stringify(storableError.body)}`,
        message: storableError.message,
        name: storableError.name,
        partitionKey: `${new Date().getMonth() + 1}`,
        retriable: storableError.retriable,
        rowKey: `${Date.now()}`
      }),
    E.toError
  );

export const toStorableError = <T>(body: T) => (
  error: CosmosErrors | t.Errors | Error
): IStorableError<T> => ({
  ...{
    body,
    name: "Storable Error"
  },
  ...("kind" in error && error.kind === "COSMOS_DECODING_ERROR"
    ? {
        message: readableReport(error.error),
        retriable: false
      }
    : "kind" in error && error.kind === "COSMOS_ERROR_RESPONSE"
    ? {
        message: JSON.stringify(error.error),
        retriable: true
      }
    : "kind" in error && error.kind === "COSMOS_EMPTY_RESPONSE"
    ? {
        message: "Empty cosmos error message",
        retriable: true
      }
    : Array.isArray(error)
    ? {
        message: readableReport(error),
        retriable: false
      }
    : {
        message: error.message,
        retriable: true
      })
});

export const storeAndLogError = <T>(
  errorStorage: TableClient,
  telemetryClient: TelemetryClient
) => (processingError: IStorableError<T>): TE.TaskEither<void, void> =>
  pipe(
    processingError,
    storeError(errorStorage),
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
  errorStorage: TableClient,
  telemetryClient: TelemetryClient
) => (error: IStorableError<T>): TE.TaskEither<IStorableError<T>, void> =>
  pipe(
    error,
    storeAndLogError(errorStorage, telemetryClient),
    TE.mapLeft(() => error)
  );

export const handleStatusChange = (
  messageViewModel: MessageViewModel,
  messageModel: MessageModel,
  blobService: BlobService
) => (
  messageStatus: RetrievedMessageStatusWithFiscalCode
): TE.TaskEither<Error | t.Errors | CosmosErrors, MessageView> =>
  pipe(
    messageViewModel.patch(
      [messageStatus.messageId, messageStatus.fiscalCode],
      {
        status: {
          archived: messageStatus.isArchived,
          processing: messageStatus.status,
          read: messageStatus.isRead
        }
      }
    ),
    TE.orElse(
      flow(
        TE.fromPredicate(
          error =>
            error.kind === "COSMOS_ERROR_RESPONSE" && error.error.code === 404,
          identity
        ),
        // find and enrich message
        TE.chain(() =>
          messageModel.find([messageStatus.messageId, messageStatus.fiscalCode])
        ),
        TE.chainW(
          TE.fromOption(
            () =>
              new Error(
                `Message metadata not found for ${messageStatus.messageId}`
              )
          )
        ),
        TE.chainW(messageWithoutContent =>
          pipe(
            messageModel.getContentFromBlob(
              blobService,
              messageWithoutContent.id
            ),
            TE.chainW(
              TE.fromOption(
                () =>
                  new Error(
                    `Message body not found for ${messageWithoutContent.id}`
                  )
              )
            ),
            TE.map(content => ({ ...messageWithoutContent, content }))
          )
        ),
        TE.map(messageWithContent => ({
          components: {
            attachments: {
              has:
                messageWithContent.content.legal_data?.has_attachment ?? false
            },
            euCovidCert: {
              has: messageWithContent.content.eu_covid_cert !== null
            },
            legalData: {
              has: messageWithContent.content.legal_data != null
            },
            payment: {
              has: messageWithContent.content.payment_data != null
            }
          },
          createdAt: messageWithContent.createdAt,
          fiscalCode: messageWithContent.fiscalCode,
          id: messageWithContent.id,
          messageTitle: messageWithContent.content.subject,
          senderServiceId: messageWithContent.senderServiceId,
          status: {
            archived: messageStatus.isArchived,
            processing: messageStatus.status,
            read: messageStatus.isRead
          },
          version: messageStatus.version
        })),
        // create message_view document
        TE.chainEitherKW(MessageView.decode),
        TE.chainW(messageView => messageViewModel.create(messageView))
      )
    )
  );

export const handle = (
  telemetryClient: TelemetryClient,
  messageViewModel: MessageViewModel,
  messageModel: MessageModel,
  errorStorage: TableClient,
  blobService: BlobService,
  rawMessageStatus: unknown
): Promise<IStorableError<unknown> | MessageView> =>
  pipe(
    rawMessageStatus,
    RetrievedMessageStatusWithFiscalCode.decode,
    TE.fromEither,
    TE.chain(handleStatusChange(messageViewModel, messageModel, blobService)),
    TE.mapLeft(toStorableError(rawMessageStatus)),
    TE.orElseFirst(storeAndLogErrorFirst(errorStorage, telemetryClient)),
    TE.toUnion
  )();
