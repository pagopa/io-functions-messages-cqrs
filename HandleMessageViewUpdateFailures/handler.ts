import { Context } from "@azure/functions";
import { MessageViewModel } from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { constVoid, flow, pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import * as t from "io-ts";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { BlobService } from "azure-storage";
import { TelemetryClient, trackException } from "../utils/appinsights";
import { errorsToError } from "../utils/conversions";
import {
  Failure,
  PermanentFailure,
  toPermanentFailure,
  TransientFailure
} from "../utils/errors";
import {
  handleStatusChange,
  RetrievedMessageStatusWithFiscalCode
} from "../utils/message_view";

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
    TE.mapLeft(flow(errorsToError, e => toPermanentFailure(e)())),
    TE.chain(failureInput =>
      pipe(
        failureInput,
        RetriableHandleMessageViewFailureInput.decode,
        TE.fromEither,
        TE.mapLeft(() => toPermanentFailure(Error(failureInput.message))()),
        TE.map(retriableFailure => retriableFailure.body)
      )
    ),
    TE.chain(handleStatusChange(messageViewModel, messageModel, blobService)),
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
          modelId: err.modelId ?? "",
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
