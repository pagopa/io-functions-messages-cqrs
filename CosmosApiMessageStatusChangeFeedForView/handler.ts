import { Context } from "@azure/functions";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { constVoid, pipe } from "fp-ts/lib/function";
import * as KP from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import * as RA from "fp-ts/ReadonlyArray";
import * as TE from "fp-ts/TaskEither";

export const handleMessageStatusChangeFeedForView = async (
  _: Context,
  rawMessageStatus: ReadonlyArray<unknown>,
  client: KP.KafkaProducerCompact<RetrievedMessageStatus>
): Promise<void> =>
  pipe(
    rawMessageStatus,
    RA.map(RetrievedMessageStatus.decode),
    RA.rights,
    KP.sendMessages(client),
    TE.mapLeft(() => {
      throw new Error("Cannot publish to Kafka topic");
    }),
    TE.map(constVoid),
    TE.toUnion
  )();
