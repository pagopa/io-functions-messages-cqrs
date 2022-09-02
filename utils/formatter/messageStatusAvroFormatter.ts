/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/naming-convention */
import * as avro from "avsc";

import { MessageFormatter } from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaTypes";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { messageStatus as avroMessage } from "../../generated/avro/dto/messageStatus";

export const buildAvroMessageStatusObject = (
  retrievedMessageStatus: RetrievedMessageStatus
): Omit<avroMessage, "schema" | "subject"> => ({
  id: retrievedMessageStatus.id,
  isArchived: retrievedMessageStatus.isArchived,
  isRead: retrievedMessageStatus.isRead,
  messageId: retrievedMessageStatus.messageId,
  // eslint-disable-next-line no-underscore-dangle
  timestamp: retrievedMessageStatus._ts * 1000,
  updatedAt: retrievedMessageStatus.updatedAt.getTime(),
  version: retrievedMessageStatus.version
});

export const toAvroMessageStatus = (messageStatus: RetrievedMessageStatus) =>
  avro.Type.forSchema(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    avroMessage.schema as avro.Schema // cast due to tsc can not proper recognize object as avro.Schema (eg. if you use const schemaServices: avro.Type = JSON.parse(JSON.stringify(services.schema())); it will loose the object type and it will work fine)
  ).toBuffer(
    Object.assign(
      new avroMessage(),
      buildAvroMessageStatusObject(messageStatus)
    )
  );

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const avroMessageStatusFormatter = (): MessageFormatter<RetrievedMessageStatus> => messageStatus => ({
  key: messageStatus.messageId,
  value: toAvroMessageStatus(messageStatus)
});
