import { BlobService } from "azure-storage";

import * as B from "fp-ts/lib/boolean";
import * as E from "fp-ts/lib/Either";
import { flow, pipe } from "fp-ts/lib/function";
import * as T from "fp-ts/lib/Task";
import * as TE from "fp-ts/lib/TaskEither";
import * as RA from "fp-ts/ReadonlyArray";

import { QueueClient } from "@azure/storage-queue";
import * as KP from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import {
  MessageModel,
  RetrievedMessage
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { TelemetryClient } from "../utils/appinsights";
import { errorsToError } from "../utils/conversions";
import {
  Failure,
  toPermanentFailure,
  toTransientFailure,
  TransientFailure
} from "../utils/errors";
import { IBulkOperationResult, publish } from "../utils/publish";
import { IStorableError, toStorableError } from "../utils/storable_error";

const CHUNK_SIZE = 15;

/**
 * Retrieve a message content from blob storage and enrich message
 */
const enrichMessageContent = (
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
        toTransientFailure(Error(`Message Content Blob not found`))(message.id)
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

export const handleMessageChange = (
  messageModel: MessageModel,
  blobService: BlobService
) => (
  client: KP.KafkaProducerCompact<RetrievedMessage>,
  errorStorage: QueueClient,
  telemetryClient: TelemetryClient,
  cqrsLogName: string,
  documents: ReadonlyArray<unknown>
): Promise<Failure | IBulkOperationResult> =>
  pipe(
    documents,
    RA.map(m =>
      pipe(
        m,
        RetrievedMessage.decode,
        E.mapLeft(
          flow(errorsToError, e => toPermanentFailure(e)(), toStorableError(m))
        )
      )
    ),
    retrievedMessages =>
      pipe(
        retrievedMessages,
        RA.rights,
        RA.filter(msg => msg.isPending === false),
        enrichMessagesContent(messageModel, CHUNK_SIZE, blobService),
        T.map(enrichResults => [
          ...pipe(retrievedMessages, RA.filter(E.isLeft)),
          ...enrichResults
        ])
      ),
    publish(client, errorStorage, telemetryClient, cqrsLogName),
    TE.mapLeft(failure =>
      pipe(
        TransientFailure.is(failure),
        B.fold(
          () => failure,
          () => {
            throw new Error(failure.reason);
          }
        )
      )
    ),
    TE.toUnion
  )();
