import * as TE from "fp-ts/lib/TaskEither";
import * as T from "fp-ts/lib/Task";
import * as E from "fp-ts/lib/Either";
import * as RA from "fp-ts/lib/ReadonlyArray";
import * as O from "fp-ts/lib/Option";

import { flow, pipe } from "fp-ts/lib/function";
import {
  MessageStatus,
  MessageStatusModel,
  RetrievedMessageStatus
} from "@pagopa/io-functions-commons/dist/src/models/message_status";
import {
  Profile,
  ProfileModel
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import { RejectedMessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/RejectedMessageStatusValue";
import { MessageModel } from "@pagopa/io-functions-commons/dist/src/models/message";
import { FiscalCode } from "@pagopa/io-functions-commons/dist/generated/definitions/FiscalCode";
import { Ttl } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model_ttl";
import { RejectionReasonEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/RejectionReason";
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
): TE.TaskEither<never, RetrievedMessageStatus> =>
  pipe(
    messageModel.patch(
      [document.messageId, document.fiscalCode as FiscalCode],
      {
        ttl: TTL_VALUE
      } as Partial<MessageStatus>
    ),
    TE.mapLeft(err => {
      throw new Error(
        `Something went wrong trying to update the message ttl | ${JSON.stringify(
          err
        )}`
      );
    }),
    TE.chain(() =>
      messageStatusModel.updateTTLForAllVersions(
        [document.messageId],
        TTL_VALUE
      )
    ),
    TE.mapLeft(err => {
      throw new Error(
        `Something went wrong trying to update the message-status ttl | ${JSON.stringify(
          err
        )}`
      );
    }),
    TE.map(() => document)
  );

export const isRejectionReasonDefined = (
  retrievedMessageStatus: RetrievedMessageStatus
): boolean =>
  retrievedMessageStatus.status === RejectedMessageStatusValueEnum.REJECTED &&
  retrievedMessageStatus.rejection_reason !== RejectionReasonEnum.UNKNOWN;

/**
  Handle the logic of setting ttl for those message-status entries related to 
  non existing users for IO.
 */

export const handleSetTTL = (
  messageStatusModel: MessageStatusModel,
  messageModel: MessageModel,
  profileModel: ProfileModel,
  telemetryClient: TelemetryClient,
  documents: ReadonlyArray<unknown>
): T.Task<ReadonlyArray<E.Either<string, RetrievedMessageStatus>>> =>
  pipe(
    documents,
    RA.map((doc: unknown) =>
      pipe(
        doc,
        RetrievedMessageStatus.decode,
        TE.fromEither,
        // if the item is not a RetrievedMessageStatus we simply track it with an event and skip it
        TE.mapLeft(() => {
          telemetryClient.trackEvent({
            name: `trigger.messages.cqrs.item-not-RetrievedMessageStatus`
          });
          return "This item is not a RetrievedMessageStatus";
        }),
        TE.chainW(isEligibleForTTL(telemetryClient)),
        TE.chainW(
          flow(
            // before all we check if the rejectionReason is defined
            TE.fromPredicate(
              isRejectionReasonDefined,
              retrievedDocument => retrievedDocument
            ),
            TE.fold(
              retrievedDocument =>
                // the rejection reason is not defined so we need to call the profileModel in order to verify if the user exists
                pipe(
                  retrievedDocument.fiscalCode,
                  FiscalCode.decode,
                  E.mapLeft(() => {
                    telemetryClient.trackEvent({
                      name: `trigger.messages.cqrs.invalid-FiscalCode`,
                      properties: {
                        id: retrievedDocument.id,
                        messageId: retrievedDocument.messageId
                      }
                    });
                    return "This item has not a valid FiscalCode";
                  }),
                  TE.fromEither,
                  TE.chainW(fiscalCode =>
                    pipe(
                      profileModel.findLastVersionByModelId([fiscalCode]),
                      TE.mapLeft(err => {
                        throw new Error(
                          `Something went wrong trying to find the profile | ${JSON.stringify(
                            err
                          )}`
                        );
                      })
                    )
                  ),
                  TE.chainW(
                    flow(
                      TE.fromPredicate(
                        (maybeProfile: O.Option<Profile>) =>
                          O.isNone(maybeProfile),
                        () => "This profile exist"
                      ),
                      TE.chainW(() =>
                        setTTLForMessageAndStatus(
                          retrievedDocument,
                          messageStatusModel,
                          messageModel
                        )
                      )
                    )
                  )
                ),
              flow(
                // the rejection reason is defined, we need to check if it is USER_NOT_FOUND, otherwise we do not set the ttl
                TE.fromPredicate(
                  retrievedDocument =>
                    RejectedMessageStatusValueEnum.REJECTED ===
                      retrievedDocument.status &&
                    RejectionReasonEnum.USER_NOT_FOUND ===
                      retrievedDocument.rejection_reason,
                  () => "The reason of the rejection is not USER_NOT_FOUND"
                ),
                // eslint-disable-next-line
                TE.chainW(retrievedDocument =>
                  setTTLForMessageAndStatus(
                    retrievedDocument,
                    messageStatusModel,
                    messageModel
                  )
                ),
                TE.chainFirst(({ status, id }) =>
                  TE.of(
                    telemetryClient.trackEvent({
                      name: `trigger.messages.cqrs.update-done`,
                      properties: {
                        id,
                        status
                      }
                    })
                  )
                )
              )
            )
          )
        )
      )
    ),
    T.sequenceArray
  );
