import { Context } from "@azure/functions";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { constVoid, pipe } from "fp-ts/lib/function";
import * as RA from "fp-ts/ReadonlyArray";
import * as KP from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import * as TE from "fp-ts/TaskEither";
import * as T from "fp-ts/Task";
import { NotRejectedMessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/NotRejectedMessageStatusValue";

export const handleAvroMessageStatusPublishChange = async (
  _: Context,
  client: KP.KafkaProducerCompact<RetrievedMessageStatus>,
  rawMessageStatus: ReadonlyArray<unknown>
): Promise<void> =>
  pipe(
    rawMessageStatus,
    RA.map(RetrievedMessageStatus.decode),
    RA.rights,
    RA.filter(
      messageStatus =>
        messageStatus.status === NotRejectedMessageStatusValueEnum.PROCESSED
    ),
    KP.sendMessages(client),
    TE.mapLeft(RA.reduce("", (acc, err) => `${acc}|${err.message}`)),
    TE.getOrElseW(errMessage => {
      throw new Error(
        `Error publishing message statuses to Reminder|${errMessage}`
      );
    }),
    T.map(constVoid)
  )();
