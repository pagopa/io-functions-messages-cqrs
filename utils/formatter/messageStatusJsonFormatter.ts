import { MessageFormatter } from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaTypes";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";

export const toJsonMessageStatus = (
  messageStatus: RetrievedMessageStatus
): string => JSON.stringify(messageStatus);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const jsonMessageStatusFormatter = (): MessageFormatter<RetrievedMessageStatus> => messageStatus => ({
  key: messageStatus.messageId,
  value: toJsonMessageStatus(messageStatus)
});
