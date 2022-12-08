/* eslint-disable max-params */
import { QueueClient } from "@azure/storage-queue";
import { NotRejectedMessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/NotRejectedMessageStatusValue";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { MessageViewModel } from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { BlobService } from "azure-storage";
import { constVoid, flow, identity, pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/TaskEither";
import { TelemetryClient } from "../utils/appinsights";
import { errorsToError } from "../utils/conversions";
import { toPermanentFailure } from "../utils/errors";
import {
  handleStatusChange,
  RetrievedMessageStatusWithFiscalCode
} from "../utils/message_view";
import {
  IStorableError,
  storeAndLogErrorOrThrow,
  toStorableError
} from "../utils/storable_error";

export const handle = (
  telemetryClient: TelemetryClient,
  queueClient: QueueClient,
  messageViewModel: MessageViewModel,
  messageModel: MessageModel,
  blobService: BlobService,
  rawMessageStatus: unknown
): Promise<IStorableError<unknown> | void> =>
  pipe(
    rawMessageStatus,
    RetrievedMessageStatusWithFiscalCode.decode,
    TE.fromEither,
    TE.mapLeft(flow(errorsToError, e => toPermanentFailure(e)())),
    TE.chain(
      flow(
        // skip Message Statuses that are not PROCESSED
        TE.fromPredicate(
          messageStatusWithFiscalCode =>
            messageStatusWithFiscalCode.status !==
            NotRejectedMessageStatusValueEnum.PROCESSED,
          identity
        ),
        TE.orElseW(
          handleStatusChange(messageViewModel, messageModel, blobService)
        )
      )
    ),
    TE.mapLeft(toStorableError(rawMessageStatus)),
    TE.orElseFirst(
      storeAndLogErrorOrThrow(queueClient, telemetryClient, "updatemessageview")
    ),
    TE.map(constVoid),
    TE.toUnion
  )();
