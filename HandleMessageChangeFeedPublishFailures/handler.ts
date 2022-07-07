import { Context } from "@azure/functions";
import {
  MessageModel,
  RetrievedMessage
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { BlobService } from "azure-storage";
import { flow, pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import * as t from "io-ts";
import { TelemetryClient, trackException } from "../utils/appinsights";
import { errorsToError } from "../utils/conversions";
import {
  Failure,
  PermanentFailure,
  toPermanentFailure,
  toTransientFailure,
  TransientFailure
} from "../utils/errors";
import { avroMessageFormatter } from "../utils/formatter/messagesAvroFormatter";
import { enrichMessageContent } from "../utils/message";

const RetriableMessagePublishFailureInput = t.interface({
  body: RetrievedMessage,
  retriable: t.literal(true)
});

type RetriableMessagePublishFailureInput = t.TypeOf<
  typeof RetriableMessagePublishFailureInput
>;
export const HandleMessagePublishFailureInput = t.union([
  RetriableMessagePublishFailureInput,
  t.interface({
    body: t.unknown,
    retriable: t.literal(false)
  })
]);
export type HandleMessagePublishFailureInput = t.TypeOf<
  typeof HandleMessagePublishFailureInput
>;

export const HandleMessageChangeFeedPublishFailureHandler = (
  context: Context,
  message: unknown,
  telemetryClient: TelemetryClient,
  messageModel: MessageModel,
  blobService: BlobService
): Promise<Failure | void> =>
  pipe(
    message,
    HandleMessagePublishFailureInput.decode,
    TE.fromEither,
    TE.mapLeft(flow(errorsToError, e => toPermanentFailure(e)())),
    TE.chain(failureInput =>
      pipe(
        failureInput,
        RetriableMessagePublishFailureInput.decode,
        TE.fromEither,
        TE.mapLeft(() =>
          toPermanentFailure(Error(JSON.stringify(failureInput.body)))()
        ),
        TE.map(retriableFailure => retriableFailure.body)
      )
    ),
    TE.chain(retrievedMessage =>
      pipe(
        enrichMessageContent(messageModel, blobService, retrievedMessage),
        TE.mapLeft(_ =>
          toTransientFailure(Error("Cannot Enrich MessageContent"))()
        )
      )
    ),
    TE.map(
      flow(avroMessageFormatter(), JSON.stringify, avroMessage => {
        // eslint-disable-next-line functional/immutable-data
        context.bindings.messages = avroMessage;
        context.done();
      })
    ),
    TE.mapLeft(err => {
      const isTransient = TransientFailure.is(err);
      const error = isTransient
        ? `HandleMessageChangeFeedPublishFailureHandler|TRANSIENT_ERROR=${err.reason}`
        : `HandleMessageChangeFeedPublishFailureHandler|FATAL|PERMANENT_ERROR=${
            err.reason
          }|INPUT=${JSON.stringify(message)}`;
      trackException(telemetryClient, {
        exception: new Error(error),
        properties: {
          detail: err.kind,
          fatal: PermanentFailure.is(err).toString(),
          isSuccess: "false",
          modelId: err.modelId ?? "",
          name: "message.cqrs.changefeed.retry.failure"
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
    TE.toUnion
  )();
