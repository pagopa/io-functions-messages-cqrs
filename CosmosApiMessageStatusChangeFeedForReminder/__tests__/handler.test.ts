import { pipe } from "fp-ts/lib/function";
import { aMessageStatus } from "../../__mocks__/message";
import { handleAvroMessageStatusPublishChange as handler } from "../handler";
import * as RA from "fp-ts/ReadonlyArray";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { toAvroMessageStatus } from "../../utils/formatter/messageStatusAvroFormatter";
import { MessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/MessageStatusValue";

// ----------------------
// Variables
// ----------------------

const topic = "aTopic";

const aListOfMessageStatus = pipe(
  Array.from({ length: 10 }, i => aMessageStatus)
);

const getExpectedMessageStatusBuffer = (
  messageStatuses: RetrievedMessageStatus[]
) => pipe(messageStatuses, RA.fromArray, RA.map(toAvroMessageStatus));

// ----------------------
// Mocks
// ----------------------

const mockContext = { bindings: {}, done: jest.fn() } as any;

const resetBindings = () => {
  mockContext.bindings = {};
};

// ----------------------
// Tests
// ----------------------

describe("CosmosApiMessageStatusChangeFeedForReminder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetBindings();
  });
  it("should send all retrieved message status", async () => {
    await handler(mockContext, aListOfMessageStatus);

    expect(mockContext.bindings["outputMessageStatus"]).toEqual(
      getExpectedMessageStatusBuffer(aListOfMessageStatus)
    );
    expect(mockContext.done).toHaveBeenCalled();
  });

  it("should send only retrieved message status that can be decoded", async () => {
    await handler(mockContext, [
      { ...aMessageStatus, status: "WRONG_STATUS" },
      ...aListOfMessageStatus
    ]);

    expect(mockContext.bindings["outputMessageStatus"]).toEqual(
      getExpectedMessageStatusBuffer(aListOfMessageStatus)
    );
    expect(mockContext.done).toHaveBeenCalled();
  });

  it("should send only PROCESSED retrieved message status", async () => {
    await handler(mockContext, [
      { ...aMessageStatus, status: MessageStatusValueEnum.REJECTED },
      ...aListOfMessageStatus
    ]);

    expect(mockContext.bindings["outputMessageStatus"]).toEqual(
      getExpectedMessageStatusBuffer(aListOfMessageStatus)
    );
    expect(mockContext.done).toHaveBeenCalled();
  });

  it("should populate output bindings only if PROCESSED retrieved message status array is not empty", async () => {
    await handler(mockContext, [
      { ...aMessageStatus, status: MessageStatusValueEnum.REJECTED }
    ]);

    expect(mockContext.bindings["outputMessageStatus"]).toBeUndefined();
    expect(mockContext.done).toHaveBeenCalled();
  });
});
