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
import { Failure, toPermanentFailure, TransientFailure } from "../utils/errors";
import { enrichMessagesContent } from "../utils/message";
import { IBulkOperationResult, publish } from "../utils/publish";
import { toStorableError } from "../utils/storable_error";

const CHUNK_SIZE = 15;

export const handleMessageChange = (
  messageModel: MessageModel,
  blobService: BlobService,
  startTimeFilter: number
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
        RA.filter(
          msg =>
            msg.isPending === false &&
            msg.createdAt.getTime() >= startTimeFilter
        ),
        enrichMessagesContent(messageModel, CHUNK_SIZE, blobService),
        T.map(enrichResults => [
          ...pipe(retrievedMessages, RA.filter(E.isLeft)),
          ...enrichResults
        ])
      ),
    publish(client, errorStorage, telemetryClient, cqrsLogName),
    TE.mapLeft(failure =>
      pipe(
        failure,
        TransientFailure.is,
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
