import { Context } from "@azure/functions";
import {
  MessageView,
  MessageViewModel
} from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { constVoid, flow, identity, pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import * as t from "io-ts";
import {
  CosmosErrorResponse,
  CosmosErrors
} from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { BlobService } from "azure-storage";
import { RetrievedMessageStatusWithFiscalCode } from "../UpdateCosmosMessageView/handler";
import { TelemetryClient, trackException } from "../utils/appinsights";
import { errorsToError } from "../utils/conversions";
import {
  Failure,
  PermanentFailure,
  toPermanentFailure,
  toTransientFailure,
  TransientFailure
} from "../utils/errors";

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

const wrapErrorToTransientFailure = (err: unknown): Failure =>
  pipe(err, E.toError, toTransientFailure);

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

export const HandleMessageViewUpdateFailureHandler = (
  context: Context,
  message: unknown,
  telemetryClient: TelemetryClient,
  messageViewModel: MessageViewModel,
  messageModel: MessageModel,
  blobService: BlobService
  // eslint-disable-next-line max-params
): Promise<Failure | void> =>
  pipe(
    message,
    HandleMessageViewFailureInput.decode,
    TE.fromEither,
    TE.mapLeft(flow(errorsToError, toPermanentFailure)),
    TE.chain(failureInput =>
      pipe(
        failureInput,
        RetriableHandleMessageViewFailureInput.decode,
        TE.fromEither,
        TE.mapLeft(() => toPermanentFailure(Error(failureInput.message)))
      )
    ),
    TE.map(retriableFailure => retriableFailure.body),
    TE.chain(messageStatus =>
      pipe(
        patchViewWithVersionCondition(messageViewModel, messageStatus),
        TE.orElseW(
          flow(
            TE.fromPredicate(
              isCosmosErrorNotFoundResponse,
              wrapErrorToTransientFailure
            ),
            // find and enrich message
            TE.chain(() =>
              pipe(
                messageModel.find([
                  messageStatus.messageId,
                  messageStatus.fiscalCode
                ]),
                TE.mapLeft(wrapErrorToTransientFailure)
              )
            ),
            TE.chain(
              TE.fromOption(() =>
                toPermanentFailure(
                  Error(
                    `Message metadata not found for ${messageStatus.messageId}`
                  )
                )
              )
            ),
            TE.chain(messageWithoutContent =>
              pipe(
                messageModel.getContentFromBlob(
                  blobService,
                  messageWithoutContent.id
                ),
                TE.mapLeft(wrapErrorToTransientFailure),
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
                    messageWithContent.content.legal_data?.has_attachment ??
                    false
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
            TE.chainEitherKW(
              flow(
                MessageView.decode,
                E.mapLeft(flow(errorsToError, toPermanentFailure))
              )
            ),
            TE.chainW(messageView => messageViewModel.create(messageView)),
            TE.mapLeft(wrapErrorToTransientFailure)
          )
        )
      )
    ),
    TE.mapLeft(err => {
      const isTransient = TransientFailure.is(err);
      const error = isTransient
        ? `HandleMessageViewUpdateFailure|TRANSIENT_ERROR=${err.reason}`
        : `HandleMessageViewUpdateFailure|FATAL|PERMANENT_ERROR=${
            err.reason
          }|INPUT=${JSON.stringify(message)}`;
      trackException(telemetryClient, {
        exception: new Error(error),
        properties: {
          detail: err.kind,
          fatal: PermanentFailure.is(err).toString(),
          isSuccess: "false",
          name: "message.view.update.retry.failure"
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
