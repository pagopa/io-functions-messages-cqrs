import { inspect } from "util";
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

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type NotComputedDocument = {
  readonly document?: RetrievedMessageStatus;
  readonly reason: string;
};

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
) => TE.TaskEither<NotComputedDocument, RetrievedMessageStatus>) => (
  document: RetrievedMessageStatus
): TE.TaskEither<NotComputedDocument, RetrievedMessageStatus> =>
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
            name: `trigger.messages.cqrs.release-timestamp-reached`,
            tagOverrides: { samplingEnabled: "false" }
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
    ),
    TE.mapLeft(reason => ({ document, reason }))
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
        `Something went wrong trying to update the message ttl for message with id: ${
          document.id
        } | ${JSON.stringify(inspect(err))}`
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
        `Something went wrong trying to update the message-status ttl for message with id: ${
          document.id
        } | ${JSON.stringify(inspect(err))}`
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
): T.Task<ReadonlyArray<
  E.Either<NotComputedDocument, RetrievedMessageStatus>
>> =>
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
            name: `trigger.messages.cqrs.item-not-RetrievedMessageStatus`,
            tagOverrides: { samplingEnabled: "false" }
          });
          return {
            reason: "This item is not a RetrievedMessageStatus"
          };
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
                        fiscalCode: retrievedDocument.fiscalCode ?? "",
                        id: retrievedDocument.id,
                        messageId: retrievedDocument.messageId
                      },
                      tagOverrides: { samplingEnabled: "false" }
                    });
                    return "This item has not a valid FiscalCode";
                  }),
                  TE.fromEither,
                  TE.chainW(fiscalCode =>
                    pipe(
                      profileModel.findLastVersionByModelId([fiscalCode]),
                      TE.mapLeft(err => {
                        throw new Error(
                          `Something went wrong trying to find the profile for message with id: ${
                            retrievedDocument.id
                          } | ${JSON.stringify(inspect(err))}`
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
                  ),
                  TE.mapLeft(reason => ({
                    document: retrievedDocument,
                    reason
                  }))
                ),
              retrievedDocument =>
                pipe(
                  retrievedDocument,
                  // the rejection reason is defined, we need to check if it is USER_NOT_FOUND, otherwise we do not set the ttl
                  TE.fromPredicate(
                    rD =>
                      RejectedMessageStatusValueEnum.REJECTED === rD.status &&
                      RejectionReasonEnum.USER_NOT_FOUND ===
                        rD.rejection_reason,
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
                  TE.mapLeft(reason => ({
                    document: retrievedDocument,
                    reason
                  }))
                )
            ),
            T.map(
              E.bimap(
                reason => {
                  if (reason.document) {
                    telemetryClient.trackEvent({
                      name: `trigger.messages.cqrs.update-not-performed`,
                      properties: {
                        id: reason.document.id,
                        reason: reason.reason,
                        status: reason.document.status
                      }
                    });
                  }

                  return reason;
                },
                document => {
                  telemetryClient.trackEvent({
                    name: `trigger.messages.cqrs.update-done`,
                    properties: {
                      id: document.id,
                      status: document.status
                    },
                    tagOverrides: { samplingEnabled: "false" }
                  });

                  return document;
                }
              )
            )
          )
        )
      )
    ),
    T.sequenceArray
  );
