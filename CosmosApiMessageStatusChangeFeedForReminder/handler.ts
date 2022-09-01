import { Context } from "@azure/functions";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { pipe } from "fp-ts/lib/function";
import * as RA from "fp-ts/ReadonlyArray";
import { MessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/MessageStatusValue";
import { toAvroMessageStatus } from "../utils/formatter/messageStatusAvroFormatter";

export const handleAvroMessageStatusPublishChange = async (
  context: Context,
  rawMessageStatus: ReadonlyArray<unknown>
): Promise<void> => {
  // eslint-disable-next-line functional/immutable-data
  context.bindings.outputMessageStatus = pipe(
    rawMessageStatus,
    RA.map(RetrievedMessageStatus.decode),
    RA.rights,
    RA.filter(
      messageStatus => messageStatus.status === MessageStatusValueEnum.PROCESSED
    ),
    RA.map(toAvroMessageStatus)
  );
  context.done();
};
