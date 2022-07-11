import { QueueClient } from "@azure/storage-queue";
import * as KP from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import * as E from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/function";
import * as TA from "fp-ts/lib/Task";
import * as TE from "fp-ts/lib/TaskEither";
import * as RA from "fp-ts/ReadonlyArray";
import { TelemetryClient } from "./appinsights";
import { Failure, toTransientFailure, TransientFailure } from "./errors";
import { IStorableError, storeAndLogError } from "./storable_error";

export interface IBulkOperationResult {
  readonly errors: string;
  readonly results: string;
}

export const publish = <T>(
  client: KP.KafkaProducerCompact<T>,
  errorStorage: QueueClient,
  telemetryClient: TelemetryClient,
  logName: string
) => (
  task: TA.Task<
    ReadonlyArray<E.Either<IStorableError<T> | IStorableError<unknown>, T>>
  >
): TE.TaskEither<Failure, IBulkOperationResult> =>
  pipe(
    task,
    TE.fromTask,
    // publish entities on brokers and store send errors
    TE.chain(input =>
      pipe(
        input,
        RA.rights,
        KP.sendMessages(client),
        TE.mapLeft(sendFailureErrors =>
          TransientFailure.encode({
            kind: "TRANSIENT",
            reason: `Cannot send messages on Kafka topic|${sendFailureErrors
              .map(err => err.message)
              .join("|")}`
          })
        ),
        TE.map(messagesSent => ({
          results: `Documents sent (${messagesSent.length}).`
        })),
        TE.chain(({ results }) =>
          pipe(input, RA.lefts, errors =>
            pipe(
              errors,
              RA.map(storeAndLogError(errorStorage, telemetryClient, logName)),
              RA.sequence(TE.ApplicativeSeq),
              TE.mapLeft(e => toTransientFailure(e)()),
              TE.map(() => ({
                errors: `Processed (${errors.length}) errors`,
                results
              }))
            )
          )
        )
      )
    )
  );
