import { BlobService } from "azure-storage";

import * as E from "fp-ts/lib/Either";
import { flow, pipe } from "fp-ts/lib/function";
import * as T from "fp-ts/lib/Task";
import * as TE from "fp-ts/lib/TaskEither";
import * as RA from "fp-ts/ReadonlyArray";

import { ServiceId } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceId";
import {
  MessageModel,
  RetrievedMessage
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { MessageContentType } from "../generated/avro/dto/MessageContentTypeEnum";
import { toPermanentFailure, toTransientFailure } from "../utils/errors";
import { IStorableError, toStorableError } from "../utils/storable_error";
import { IConfig } from "./config";
/**
 * Retrieve a message content from blob storage and enrich message
 */
export const enrichMessageContent = (
  messageModel: MessageModel,
  blobService: BlobService,
  message: RetrievedMessage
): TE.TaskEither<IStorableError<RetrievedMessage>, RetrievedMessage> =>
  pipe(
    messageModel.getContentFromBlob(blobService, message.id),
    TE.mapLeft(e =>
      toTransientFailure(
        e,
        "Cannot read message content from storage"
      )(message.id)
    ),
    TE.chain(
      TE.fromOption(() =>
        toPermanentFailure(Error(`Message Content Blob not found`))(message.id)
      )
    ),
    TE.mapLeft(toStorableError(message)),
    TE.map(content => ({
      ...message,
      content,
      kind: "IRetrievedMessageWithContent"
    }))
  );

/**
 * Enrich messages with content, retrieved from blob storage, if exists
 *
 */
export const enrichMessagesContent = (
  messageModel: MessageModel,
  messageContentChunkSize: number,
  blobService: BlobService
) => (
  messages: ReadonlyArray<RetrievedMessage>
): T.Task<
  ReadonlyArray<E.Either<IStorableError<RetrievedMessage>, RetrievedMessage>>
> =>
  pipe(
    messages,
    // split execution in chunks of 'messageContentChunkSize'
    RA.chunksOf(messageContentChunkSize),
    RA.map(
      flow(
        RA.map(m =>
          m.isPending === false
            ? enrichMessageContent(messageModel, blobService, m)
            : TE.of(m)
        ),
        // call task in parallel
        RA.sequence(T.ApplicativePar)
      )
    ),
    // call chunk tasks sequentially
    RA.sequence(T.ApplicativeSeq),
    T.map(RA.flatten)
  );

export interface IThirdPartyDataWithCategory {
  readonly category: Exclude<MessageContentType, MessageContentType.PAYMENT>;
}

export type ThirdPartyDataWithCategoryFetcher = (
  serviceId: ServiceId
) => IThirdPartyDataWithCategory;

export const getThirdPartyDataWithCategoryFetcher: (
  config: IConfig
) => ThirdPartyDataWithCategoryFetcher = (
  config
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) => serviceId =>
  pipe(
    serviceId,
    E.fromPredicate(
      id => id === config.PN_SERVICE_ID,
      id => Error(`Missing third-party service configuration for ${id}`)
    ),
    E.map(() => MessageContentType.PN as const),
    E.mapLeft(() => MessageContentType.GENERIC as const),
    E.toUnion,
    category => ({
      category
    })
  );
