import * as TE from "fp-ts/lib/TaskEither";
import * as RA from "fp-ts/lib/ReadonlyArray";
import * as O from "fp-ts/lib/Option";

import { flow, pipe } from "fp-ts/lib/function";
import {
  MessageStatus,
  MessageStatusModel,
  RetrievedMessageStatus
} from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { Context } from "@azure/functions";
import {
  Profile,
  ProfileModel
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import { RejectedMessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/RejectedMessageStatusValue";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { FiscalCode } from "@pagopa/io-functions-commons/dist/generated/definitions/FiscalCode";
import { CosmosErrors } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { Ttl } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model_ttl";
import { TelemetryClient } from "../utils/appinsights";

/**
  the timestamp related to 2022-11-23   20:00:00
  we have released the version of fn-service that adds the TTL to message and message-status,
  so we do no longer want to clean up after this ts
 */
export const RELEASE_TIMESTAMP = 1669233600;

/**
  3 years in seconds
 */

export const TTL_VALUE = 94670856 as Ttl;

export const isStatusRejected = (document: RetrievedMessageStatus): boolean =>
  document.status === RejectedMessageStatusValueEnum.REJECTED;

/** Return true if the given resource does NOT have the ttl */
export const hasNotTTL = (document: RetrievedMessageStatus): boolean =>
  document.ttl ? false : true;

/**
  Given 2 timestamps return true whether the first one is before the second
 */

export const isBeforeDate = (firstTs: number, secondTs: number): boolean =>
  firstTs < secondTs;

export const isEligibleForTTL = (
  telemetryClient: TelemetryClient
): ((
  document: RetrievedMessageStatus
) => TE.TaskEither<string, RetrievedMessageStatus>) => (
  document: RetrievedMessageStatus
): TE.TaskEither<string, RetrievedMessageStatus> =>
  pipe(
    document,
    TE.fromPredicate(
      isStatusRejected,
      () => `This message status is not rejected`
    ),
    TE.chain(
      TE.fromPredicate(
        // eslint-disable-next-line no-underscore-dangle
        () => isBeforeDate(document._ts, RELEASE_TIMESTAMP),
        () => {
          telemetryClient.trackEvent({
            name: `trigger.messages.cqrs.release-timestamp-reached`
          });
          // eslint-disable-next-line no-underscore-dangle
          return `the timestamp of the document ${document.id} (${document._ts}) is after the RELEASE_TIMESTAMP ${RELEASE_TIMESTAMP}`;
        }
      )
    ),
    TE.chain(
      TE.fromPredicate(
        hasNotTTL,
        () => `the document ${document.id} has a ttl already`
      )
    )
  );

/**
  Return a Right if the document is eligible for the ttl
 */

export const setTTLForMessageAndStatus = (
  document: RetrievedMessageStatus,
  messageStatusModel: MessageStatusModel,
  messageModel: MessageModel
): TE.TaskEither<CosmosErrors, RetrievedMessageStatus> =>
  pipe(
    messageModel.patch(
      [document.messageId, document.fiscalCode as FiscalCode],
      {
        ttl: TTL_VALUE
      } as Partial<MessageStatus>
    ),
    TE.chain(() =>
      messageStatusModel.updateTTLForAllVersions(
        [document.messageId],
        TTL_VALUE
      )
    ),
    TE.map(() => document)
  );

/**
  Handle the logic of setting ttl for those message-status entries related to 
  non existing users for IO.
 */

export const handleSetTTL = (
  messageStatusModel: MessageStatusModel,
  messageModel: MessageModel,
  profileModel: ProfileModel,
  context: Context,
  telemetryClient: TelemetryClient,
  documents: ReadonlyArray<RetrievedMessageStatus>
): TE.TaskEither<
  string | CosmosErrors,
  ReadonlyArray<RetrievedMessageStatus>
  // eslint-disable-next-line max-params
> =>
  pipe(
    documents,
    RA.map((d: RetrievedMessageStatus) =>
      pipe(
        d,
        isEligibleForTTL(telemetryClient),
        TE.mapLeft((e: string) => {
          context.log(e);
          return e;
        }),
        TE.chainW(() =>
          pipe(
            // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
            profileModel.findLastVersionByModelId([d.fiscalCode!]),
            TE.chainW(
              flow(
                TE.fromPredicate(
                  (maybeProfile: O.Option<Profile>) => O.isNone(maybeProfile),
                  () => "This profile exist"
                ),
                TE.chainW(() =>
                  setTTLForMessageAndStatus(d, messageStatusModel, messageModel)
                )
              )
            )
          )
        )
      )
    ),
    TE.sequenceArray
  );
