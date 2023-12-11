import { PaymentNoticeNumber } from "@pagopa/io-functions-commons/dist/generated/definitions/PaymentNoticeNumber";
import { PaymentStatusEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/PaymentStatus";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import {
  MessageView,
  MessageViewModel
} from "@pagopa/io-functions-commons/dist/src/models/message_view";
import {
  CosmosErrorResponse,
  CosmosErrors
} from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { DateFromString } from "@pagopa/ts-commons/lib/dates";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";
import { FiscalCode, NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { withoutUndefinedValues } from "@pagopa/ts-commons/lib/types";
import { BlobService } from "azure-storage";
import * as E from "fp-ts/lib/Either";
import { constVoid, flow, pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import * as t from "io-ts";
import { identity } from "io-ts";
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

export const PaymentUpdate = t.intersection([
  t.interface({
    fiscalCode: FiscalCode,
    messageId: NonEmptyString,
    noticeNumber: PaymentNoticeNumber,
    paid: t.boolean
  }),
  t.partial({
    amount: NonNegativeInteger,
    dueDate: t.union([t.null, DateFromString])
  })
]);

export type PaymentUpdate = t.TypeOf<typeof PaymentUpdate>;

const isCosmosErrorPreconditionResponse = (
  err: CosmosErrors
): err is CosmosErrorResponseType =>
  err.kind === "COSMOS_ERROR_RESPONSE" && err.error.code === 412;

const isCosmosErrorNotFoundResponse = (
  err: CosmosErrors
): err is CosmosErrorResponseType =>
  err.kind === "COSMOS_ERROR_RESPONSE" && err.error.code === 404;

const wrapErrorToTransientFailure = (
  customReason?: string,
  modelId?: string
) => (err: unknown): Failure =>
  pipe(err, E.toError, e => toTransientFailure(e, customReason)(modelId));

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
          wrapErrorToTransientFailure(
            "Cannot Patch Message View",
            messageStatus.messageId
          )
        ),
        // find and enrich message
        TE.chain(() =>
          pipe(
            messageModel.find([
              messageStatus.messageId,
              messageStatus.fiscalCode
            ]),
            TE.mapLeft(
              wrapErrorToTransientFailure(
                "Cannot find message",
                messageStatus.messageId
              )
            )
          )
        ),
        TE.chain(
          TE.fromOption(() =>
            toPermanentFailure(
              Error(`Message metadata not found for ${messageStatus.messageId}`)
            )(messageStatus.messageId)
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
                "Cannot get message content from Blob",
                messageStatus.messageId
              )
            ),
            TE.chainW(
              TE.fromOption(() =>
                toPermanentFailure(
                  new Error(
                    `Message body not found for ${messageWithoutContent.id}`
                  )
                )(messageStatus.messageId)
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
              has: messageWithContent.content.eu_covid_cert != null
            },
            legalData: {
              has: messageWithContent.content.legal_data != null
            },
            payment: withoutUndefinedValues({
              due_date:
                messageWithContent.content.payment_data != null
                  ? messageWithContent.content.due_date
                  : undefined,
              has: messageWithContent.content.payment_data != null,
              notice_number:
                messageWithContent.content.payment_data?.notice_number
            }),
            thirdParty: {
              has: messageWithContent.content.third_party_data != null,
              has_attachments:
                messageWithContent.content.third_party_data?.has_attachments,
              has_precondition:
                messageWithContent.content.third_party_data?.has_precondition,
              has_remote_content:
                messageWithContent.content.third_party_data?.has_remote_content,
              id: messageWithContent.content.third_party_data?.id,
              original_recipient_date:
                messageWithContent.content.third_party_data
                  ?.original_receipt_date,
              original_sender:
                messageWithContent.content.third_party_data?.original_sender,
              summary: messageWithContent.content.third_party_data?.summary
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
        TE.mapLeft(
          wrapErrorToTransientFailure(
            "Cannot create Message View",
            messageStatus.messageId
          )
        )
      )
    ),
    TE.map(constVoid)
  );

export const handlePaymentChange = (messageViewModel: MessageViewModel) => (
  paymentUpdate: PaymentUpdate
): TE.TaskEither<Failure, void> =>
  pipe(
    messageViewModel.find([paymentUpdate.messageId, paymentUpdate.fiscalCode]),
    TE.mapLeft(() =>
      wrapErrorToTransientFailure()(Error("Cannot find Message view"))
    ),
    TE.chainW(
      TE.fromOption(() => toTransientFailure(Error("Message view Not Found"))())
    ),
    TE.chainW(existingMessageView =>
      pipe(
        messageViewModel.upsert({
          ...existingMessageView,
          components: {
            ...existingMessageView.components,
            payment: withoutUndefinedValues({
              due_date:
                paymentUpdate.dueDate != null
                  ? paymentUpdate.dueDate
                  : undefined,
              has: true,
              notice_number: paymentUpdate.noticeNumber,
              payment_status: paymentUpdate.paid
                ? PaymentStatusEnum.PAID
                : PaymentStatusEnum.NOT_PAID
            })
          }
        }),
        TE.mapLeft(() =>
          wrapErrorToTransientFailure()(Error("Cannot Upsert MessageView"))
        )
      )
    ),
    TE.map(constVoid)
  );
