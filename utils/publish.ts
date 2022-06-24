import { QueueClient } from "@azure/storage-queue";
import * as KP from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import { pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import * as RA from "fp-ts/ReadonlyArray";
import { TelemetryClient } from "./appinsights";
import { Failure, toTransientFailure, TransientFailure } from "./errors";
import {
  IStorableError,
  storeAndLogError,
  toStorableError
} from "./storable_error";

export const publish = <T>(
  client: KP.KafkaProducerCompact<T>,
  errorStorage: QueueClient,
  telemetryClient: TelemetryClient,
  logName: string
) => (
  task: TE.TaskEither<ReadonlyArray<IStorableError<T>>, ReadonlyArray<T>>
): TE.TaskEither<Failure, string> =>
  pipe(
    task,
    // publish entities on brokers and store send errors
    TE.chain(input =>
      pipe(
        input,
        KP.sendMessages(client),
        TE.mapLeft(
          RA.map(_ =>
            pipe(
              TransientFailure.encode({
                kind: "TRANSIENT",
                reason: "Cannot send message on Kafka topic"
              }),
              toStorableError(_.body)
            )
          )
        ),
        TE.map(messagesSent => `Documents sent (${messagesSent.length}).`)
      )
    ),
    TE.orElseW(errors =>
      pipe(
        errors,
        RA.map(storeAndLogError(errorStorage, telemetryClient, logName)),
        RA.sequence(TE.ApplicativeSeq),
        TE.mapLeft(e => toTransientFailure(e)()),
        TE.map(() => `Processed (${errors.length}) errors`)
      )
    )
  );
