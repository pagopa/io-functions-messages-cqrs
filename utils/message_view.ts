import {
  MessageView,
  MessageViewModel
} from "@pagopa/io-functions-commons/dist/src/models/message_view";
import {
  CosmosErrorResponse,
  CosmosErrors
} from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { pipe, flow, constVoid } from "fp-ts/lib/function";
import { identity } from "io-ts";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import * as t from "io-ts";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { BlobService } from "azure-storage";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { errorsToError } from "./conversions";
import { Failure, toPermanentFailure, toTransientFailure } from "./errors";

export const RetrievedMessageStatusWithFiscalCode = t.intersection([
  RetrievedMessageStatus,
  t.interface({ fiscalCode: FiscalCode })
]);
export type RetrievedMessageStatusWithFiscalCode = t.TypeOf<
  typeof RetrievedMessageStatusWithFiscalCode
>;

const RetriableHandleMessageViewFailureInput = t.interface({
  body: RetrievedMessageStatusWithFiscalCode,
  retriable: t.literal(true)
});

type RetriableHandleMessageViewFailureInput = t.TypeOf<
  typeof RetriableHandleMessageViewFailureInput
>;
export const HandleMessageViewFailureInput = t.intersection([
  t.union([
    RetriableHandleMessageViewFailureInput,
    t.interface({
      retriable: t.literal(false)
    })
  ]),
  t.interface({
    message: t.string
  })
]);
export type HandleMessageViewFailureInput = t.TypeOf<
  typeof HandleMessageViewFailureInput
>;

type CosmosErrorResponseType = ReturnType<typeof CosmosErrorResponse>;

const isCosmosErrorPreconditionResponse = (
  err: CosmosErrors
): err is CosmosErrorResponseType =>
  err.kind === "COSMOS_ERROR_RESPONSE" && err.error.code === 412;

const isCosmosErrorNotFoundResponse = (
  err: CosmosErrors
): err is CosmosErrorResponseType =>
  err.kind === "COSMOS_ERROR_RESPONSE" && err.error.code === 404;

const wrapErrorToTransientFailure = (customReason?: string) => (
  err: unknown
): Failure => pipe(err, E.toError, e => toTransientFailure(e, customReason));

const patchViewWithVersionCondition = (
  messageViewModel: MessageViewModel,
  messageStatus: RetrievedMessageStatusWithFiscalCode
): TE.TaskEither<CosmosErrors, void> =>
  pipe(
    messageViewModel.patch(
      [messageStatus.messageId, messageStatus.fiscalCode],
      {
        status: {
          archived: messageStatus.isArchived,
          processing: messageStatus.status,
          read: messageStatus.isRead
        },
        version: messageStatus.version
      },
      `FROM c WHERE c.version < ${messageStatus.version}`
    ),
    TE.orElseW(
      flow(
        TE.fromPredicate(isCosmosErrorPreconditionResponse, identity),
        TE.map(constVoid)
      )
    ),
    TE.map(constVoid)
  );

export const handleStatusChange = (
  messageViewModel: MessageViewModel,
  messageModel: MessageModel,
  blobService: BlobService
) => (
  messageStatus: RetrievedMessageStatusWithFiscalCode
): TE.TaskEither<Failure, void> =>
  pipe(
    patchViewWithVersionCondition(messageViewModel, messageStatus),
    TE.orElseW(
      flow(
        TE.fromPredicate(
          isCosmosErrorNotFoundResponse,
          wrapErrorToTransientFailure("Cannot Patch Message View")
        ),
        // find and enrich message
        TE.chain(() =>
          pipe(
            messageModel.find([
              messageStatus.messageId,
              messageStatus.fiscalCode
            ]),
            TE.mapLeft(wrapErrorToTransientFailure("Cannot find message"))
          )
        ),
        TE.chain(
          TE.fromOption(() =>
            toPermanentFailure(
              Error(`Message metadata not found for ${messageStatus.messageId}`)
            )
          )
        ),
        TE.chain(messageWithoutContent =>
          pipe(
            messageModel.getContentFromBlob(
              blobService,
              messageWithoutContent.id
            ),
            TE.mapLeft(
              wrapErrorToTransientFailure(
                "Cannot get message content from Blob"
              )
            ),
            TE.chainW(
              TE.fromOption(() =>
                toPermanentFailure(
                  new Error(
                    `Message body not found for ${messageWithoutContent.id}`
                  )
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
              has: messageWithContent.content.payment_data != null,
              notice_number:
                messageWithContent.content.payment_data?.notice_number
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
        TE.chainEitherKW(
          flow(
            MessageView.decode,
            E.mapLeft(flow(errorsToError, toPermanentFailure))
          )
        ),
        TE.chainW(messageView => messageViewModel.create(messageView)),
        TE.mapLeft(wrapErrorToTransientFailure("Cannot create Message View"))
      )
    ),
    TE.map(constVoid)
  );
