import {
  CosmosEmptyResponse,
  CosmosDecodingError,
  CosmosErrorResponse
} from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import {
  toStorableError,
  storeAndLogError,
  handleStatusChange,
  RetrievedMessageStatusWithFiscalCode
} from "../handler";
import * as t from "io-ts";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";
import { NonEmptyString, FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { ServiceId } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceId";
import { TimeToLiveSeconds } from "@pagopa/io-functions-commons/dist/generated/definitions/TimeToLiveSeconds";
import { MessageStatusValueEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/MessageStatusValue";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";
import { MessageContent } from "@pagopa/io-functions-commons/dist/generated/definitions/MessageContent";
import {
  Components,
  MessageView,
  Status
} from "@pagopa/io-functions-commons/dist/src/models/message_view";

const aFiscalCode = "FRLFRC74E04B157I" as FiscalCode;
const aMessageId = "A_MESSAGE_ID" as NonEmptyString;

const cosmosMetadata = {
  _etag: "_etag",
  _rid: "_rid",
  _self: "_self",
  _ts: 1
};

const aRetrievedMessageWithoutContent = {
  ...cosmosMetadata,
  fiscalCode: aFiscalCode,
  id: aMessageId,
  indexedId: "A_MESSAGE_ID" as NonEmptyString,
  senderServiceId: "agid" as ServiceId,
  senderUserId: "u123" as NonEmptyString,
  timeToLiveSeconds: 3600 as TimeToLiveSeconds,
  createdAt: new Date(),
  kind: "INewMessageWithoutContent"
};

const aMessageBodyMarkdown = "test".repeat(80);
const aMessageContent = E.getOrElseW(() => {
  throw new Error();
})(
  MessageContent.decode({
    markdown: aMessageBodyMarkdown,
    subject: "test".repeat(10)
  })
);

const MyValue = t.interface({ test: t.string });

const dummyDocument = {
  test: "test value"
};

const dummyCosmosErrorResponse = CosmosErrorResponse({
  code: 500,
  message: "error message",
  name: "error name"
});

const dummyStorableError = {
  name: "Storable Error",
  body: dummyDocument,
  message: "error message",
  retriable: true
};

const aMessageStatus: RetrievedMessageStatusWithFiscalCode = {
  ...cosmosMetadata,
  messageId: aMessageId,
  id: `${aMessageId}-0` as NonEmptyString,
  status: MessageStatusValueEnum.PROCESSED,
  version: 0 as NonNegativeInteger,
  updatedAt: new Date(),
  fiscalCode: aFiscalCode,
  isRead: false,
  isArchived: false,
  kind: "IRetrievedMessageStatus"
};

const aComponents: Components = {
  attachments: { has: false },
  euCovidCert: { has: false },
  legalData: { has: false },
  payment: { has: false }
};

const aStatus: Status = {
  archived: false,
  processing: MessageStatusValueEnum.PROCESSED,
  read: false
};

const aMessageView: MessageView = {
  components: aComponents,
  createdAt: new Date(),
  fiscalCode: aFiscalCode,
  id: aMessageId,
  messageTitle: "a-msg-title" as NonEmptyString,
  senderServiceId: "a-service-id" as ServiceId,
  status: aStatus,
  version: 0 as NonNegativeInteger
};

const mockAppinsights = {
  trackEvent: jest.fn()
};

const mockTableStorage = {
  createEntity: jest.fn()
};

const mockMessageViewModel = {
  patch: jest.fn(),
  create: jest.fn()
};

const mockMessageModel = {
  find: jest.fn(),
  getContentFromBlob: jest.fn()
};

const mockBlobService = {
  getBlobAsText: jest
    .fn()
    .mockReturnValue(
      Promise.resolve(E.right(O.some(JSON.stringify(aMessageContent))))
    )
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("toStorableError", () => {
  it("GIVEN an Error WHEN toStorableError is called THEN a storable error is returend", async () => {
    const result = toStorableError(dummyDocument)(new Error("error message"));
    expect(result).toEqual(dummyStorableError);
  });

  it("GIVEN an CosmosEmptyError WHEN toStorableError is called THEN a storable error is returend", async () => {
    const result = toStorableError({})(CosmosEmptyResponse);
    expect(result.message).toEqual("Empty cosmos error message");
    expect(result.retriable).toBeTruthy();
  });

  it("GIVEN an CosmosErrorResponse WHEN toStorableError is called THEN a storable error is returend", async () => {
    const result = toStorableError({})(dummyCosmosErrorResponse);
    expect(result.message).toEqual(
      JSON.stringify(dummyCosmosErrorResponse.error)
    );
    expect(result.retriable).toBeTruthy();
  });

  it("GIVEN an CosmosDecodingError WHEN toStorableError is called THEN a storable error is returend", async () => {
    pipe(
      MyValue.decode({}),
      E.mapLeft(CosmosDecodingError),
      E.mapLeft(toStorableError({})),
      E.mapLeft(result => {
        expect(result.message).toEqual(
          "value [undefined] at [root.test] is not a valid [string]"
        );
        expect(result.retriable).toBeFalsy();
      })
    );
  });

  it("GIVEN an t.Errors WHEN toStorableError is called THEN a storable error is returend", async () => {
    pipe(
      MyValue.decode({}),
      E.mapLeft(toStorableError({})),
      E.mapLeft(result => {
        expect(result.message).toEqual(
          "value [undefined] at [root.test] is not a valid [string]"
        );
        expect(result.retriable).toBeFalsy();
      })
    );
  });
});

describe("storeAndLogError", () => {
  it("GIVEN a working table storage client WHEN an error is stored THEN a new entity in the table is created and an event is tracked", async () => {
    mockTableStorage.createEntity.mockImplementationOnce(() =>
      Promise.resolve(true)
    );
    const result = await storeAndLogError(
      mockTableStorage as any,
      mockAppinsights as any
    )(dummyStorableError)();

    expect(E.isRight(result)).toBeTruthy();
    expect(mockTableStorage.createEntity).toBeCalledWith(
      expect.objectContaining({
        ...dummyStorableError,
        body: JSON.stringify(dummyStorableError.body)
      })
    );
    expect(mockAppinsights.trackEvent).toBeCalledWith(
      expect.objectContaining({ name: "trigger.elt.updatemessageview.failed" })
    );
  });

  it("GIVEN a not wroking table storage client WHEN an error is stored THEN no entities are created and an event is tracked", async () => {
    mockTableStorage.createEntity.mockImplementationOnce(() =>
      Promise.reject(new Error("createEntity failed"))
    );
    const result = await storeAndLogError(
      mockTableStorage as any,
      mockAppinsights as any
    )(dummyStorableError)();

    expect(E.isLeft(result)).toBeTruthy();
    expect(mockTableStorage.createEntity).toBeCalledWith(
      expect.objectContaining({
        ...dummyStorableError,
        body: JSON.stringify(dummyStorableError.body)
      })
    );
    expect(mockAppinsights.trackEvent).toBeCalledWith(
      expect.objectContaining({
        name: "trigger.elt.updatemessageview.failedwithoutstoringerror"
      })
    );
  });
});

describe("handleStatusChange", () => {
  it("GIVEN a valid message_status WHEN the message_view already contains the message THEN the message_view is updated with status data from message_status", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(TE.right(aMessageView));

    const result = await handleStatusChange(
      mockMessageViewModel as any,
      mockMessageModel as any,
      mockBlobService as any
    )(aMessageStatus)();

    expect(E.isRight(result)).toBeTruthy();
    expect(mockMessageViewModel.patch).toBeCalledWith(
      [aMessageId, aFiscalCode],
      {
        status: {
          archived: aMessageStatus.isArchived,
          processing: aMessageStatus.status,
          read: aMessageStatus.isRead
        }
      }
    );
  });

  it("GIVEN a valid message_status WHEN the message_view not contains the message THEN the message_status is enriched and a new message_view document is created", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageViewModel.create.mockReturnValueOnce(TE.right(aMessageView));
    mockMessageModel.getContentFromBlob.mockReturnValueOnce(
      TE.right(O.some(aMessageContent))
    );
    mockMessageModel.find.mockReturnValueOnce(
      TE.right(O.some(aRetrievedMessageWithoutContent))
    );

    const result = await handleStatusChange(
      mockMessageViewModel as any,
      mockMessageModel as any,
      mockBlobService as any
    )(aMessageStatus)();

    expect(E.isRight(result)).toBeTruthy();
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
    expect(mockMessageModel.find).toBeCalledWith([aMessageId, aFiscalCode]);
    expect(mockMessageViewModel.create).toBeCalledWith(
      expect.objectContaining({
        components: {
          attachments: { has: false },
          euCovidCert: { has: true },
          legalData: { has: false },
          payment: { has: false }
        },
        fiscalCode: aFiscalCode,
        id: aMessageId,
        messageTitle: "testtesttesttesttesttesttesttesttesttest",
        senderServiceId: "agid",
        status: { archived: false, processing: "PROCESSED", read: false },
        timeToLive: 3600,
        version: 0
      })
    );
  });

  it("GIVEN a valid message_status WHEN the message_view model is not working THEN a CosmosErrors is returned", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 500, name: "error", message: "error" })
      )
    );

    const result = await handleStatusChange(
      mockMessageViewModel as any,
      mockMessageModel as any,
      mockBlobService as any
    )(aMessageStatus)();

    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual(
        expect.objectContaining({ kind: "COSMOS_ERROR_RESPONSE" })
      );
    }
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
  });

  it("GIVEN a valid message_status WHEN the message_view and the messages both not contains the message THEN an Error is returned", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageModel.find.mockReturnValueOnce(TE.right(O.none));

    const result = await handleStatusChange(
      mockMessageViewModel as any,
      mockMessageModel as any,
      mockBlobService as any
    )(aMessageStatus)();

    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual(
        new Error(`Message metadata not found for ${aMessageId}`)
      );
    }
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
    expect(mockMessageModel.find).toBeCalledWith([aMessageId, aFiscalCode]);
  });

  it("GIVEN a valid message_status WHEN the message_view and the message body both not contains the message THEN an Error is returned", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageModel.getContentFromBlob.mockReturnValueOnce(TE.right(O.none));
    mockMessageModel.find.mockReturnValueOnce(
      TE.right(O.some(aRetrievedMessageWithoutContent))
    );

    const result = await handleStatusChange(
      mockMessageViewModel as any,
      mockMessageModel as any,
      mockBlobService as any
    )(aMessageStatus)();

    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual(
        new Error(`Message body not found for ${aMessageId}`)
      );
    }
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
    expect(mockMessageModel.find).toBeCalledWith([aMessageId, aFiscalCode]);
    expect(mockMessageModel.getContentFromBlob).toBeCalledWith(
      expect.anything(),
      aMessageId
    );
  });

  it("GIVEN a valid message_status WHEN the message_view not contains the message and the messages model do not work THEN an CosmosErrors is returned", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageViewModel.create.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 500, name: "error", message: "error" })
      )
    );
    mockMessageModel.getContentFromBlob.mockReturnValueOnce(
      TE.right(O.some(aMessageContent))
    );
    mockMessageModel.find.mockReturnValueOnce(
      TE.right(O.some(aRetrievedMessageWithoutContent))
    );

    const result = await handleStatusChange(
      mockMessageViewModel as any,
      mockMessageModel as any,
      mockBlobService as any
    )(aMessageStatus)();

    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual(
        expect.objectContaining({ kind: "COSMOS_ERROR_RESPONSE" })
      );
    }
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
    expect(mockMessageModel.find).toBeCalledWith([aMessageId, aFiscalCode]);
    expect(mockMessageViewModel.create).toBeCalledWith(
      expect.objectContaining({
        components: {
          attachments: { has: false },
          euCovidCert: { has: true },
          legalData: { has: false },
          payment: { has: false }
        },
        fiscalCode: aFiscalCode,
        id: aMessageId,
        messageTitle: "testtesttesttesttesttesttesttesttesttest",
        senderServiceId: "agid",
        status: { archived: false, processing: "PROCESSED", read: false },
        timeToLive: 3600,
        version: 0
      })
    );
  });
});
