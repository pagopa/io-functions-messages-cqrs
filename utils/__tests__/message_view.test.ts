import { MessageContent } from "@pagopa/io-functions-commons/dist/generated/definitions/MessageContent";
import { PaymentAmount } from "@pagopa/io-functions-commons/dist/generated/definitions/PaymentAmount";
import { PaymentNoticeNumber } from "@pagopa/io-functions-commons/dist/generated/definitions/PaymentNoticeNumber";
import { PaymentStatusEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/PaymentStatus";
import { MessageView } from "@pagopa/io-functions-commons/dist/src/models/message_view";
import { CosmosErrorResponse } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/TaskEither";
import {
  aFiscalCode,
  aMessageContent,
  aMessageContentWithDueDate,
  aMessageId,
  aMessageStatus,
  aMessageView,
  aRetrievedMessageWithoutContent
} from "../../__mocks__/message";
import {
  handlePaymentChange,
  handleStatusChange,
  PaymentUpdate
} from "../message_view";

const mockMessageViewModel = {
  find: jest.fn(),
  patch: jest.fn(),
  create: jest.fn(),
  upsert: jest.fn()
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

const aMessageContentWithThirdParty: MessageContent = {
  ...aMessageContent,
  third_party_data: {
    id: "0" as NonEmptyString
  }
};

const aMessageContentWithPaymentWithoutDueDate: MessageContent = {
  ...aMessageContent,
  payment_data: {
    notice_number: "177777777777777777" as PaymentNoticeNumber,
    amount: 1 as PaymentAmount
  }
};

const aMessageContentWithPaymentWithDueDate: MessageContent = {
  ...aMessageContentWithDueDate,
  payment_data: {
    notice_number: "177777777777777777" as PaymentNoticeNumber,
    amount: 1 as PaymentAmount
  }
};
describe("handleStatusChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
        },
        version: aMessageStatus.version
      },
      expect.anything()
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
          euCovidCert: { has: false },
          legalData: { has: false },
          payment: { has: false },
          thirdParty: { has: false }
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

  it("GIVEN a valid message_status WHEN the message_view not contains the message THEN the message_status is enriched and a new message_view document with third party is created", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageViewModel.create.mockReturnValueOnce(TE.right(aMessageView));
    mockMessageModel.getContentFromBlob.mockReturnValueOnce(
      TE.right(O.some(aMessageContentWithThirdParty))
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
          euCovidCert: { has: false },
          legalData: { has: false },
          payment: { has: false },
          thirdParty: {
            has: true,
            has_attachments: false,
            has_remote_content: false,
            id: aMessageContentWithThirdParty.third_party_data?.id
          }
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

  it("GIVEN a valid message_status WHEN the message_view not contains the message THEN the message_status is enriched and a new message_view document with payment is created", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageViewModel.create.mockReturnValueOnce(TE.right(aMessageView));
    mockMessageModel.getContentFromBlob.mockReturnValueOnce(
      TE.right(O.some(aMessageContentWithPaymentWithoutDueDate))
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
          euCovidCert: { has: false },
          legalData: { has: false },
          payment: {
            has: true,
            notice_number:
              aMessageContentWithPaymentWithoutDueDate.payment_data
                ?.notice_number,
            payment_status: PaymentStatusEnum.NOT_PAID
          },
          thirdParty: {
            has: false
          }
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

  it("GIVEN a valid message_status WHEN the message_view not contains the message THEN the message_status is enriched and a new message_view document with payment and due date is created", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageViewModel.create.mockReturnValueOnce(TE.right(aMessageView));
    mockMessageModel.getContentFromBlob.mockReturnValueOnce(
      TE.right(O.some(aMessageContentWithPaymentWithDueDate))
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
          euCovidCert: { has: false },
          legalData: { has: false },
          payment: {
            due_date: aMessageContentWithPaymentWithDueDate.due_date,
            has: true,
            notice_number:
              aMessageContentWithPaymentWithDueDate.payment_data?.notice_number,
            payment_status: PaymentStatusEnum.NOT_PAID
          },
          thirdParty: {
            has: false
          }
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

  it("GIVEN a valid message_status WHEN the message_view not contains the message THEN the message_status is enriched and a new message_view document without payment and due date is created", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageViewModel.create.mockReturnValueOnce(TE.right(aMessageView));
    mockMessageModel.getContentFromBlob.mockReturnValueOnce(
      TE.right(O.some(aMessageContentWithDueDate))
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
          euCovidCert: { has: false },
          legalData: { has: false },
          payment: {
            has: false
          },
          thirdParty: {
            has: false
          }
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

  it("GIVEN a valid message_status WHEN the message_view model is not working THEN a Transient Error is returned", async () => {
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
        expect.objectContaining({ kind: "TRANSIENT" })
      );
    }
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
  });

  it("GIVEN a valid message_status WHEN the message_view and the messages both not contains the message THEN a Transient Error is returned", async () => {
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
        expect.objectContaining({ kind: "TRANSIENT" })
      );
    }
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
    expect(mockMessageModel.find).toBeCalledWith([aMessageId, aFiscalCode]);
  });

  it("GIVEN a valid message_status WHEN the message_view and the message body both not contains the message THEN a Transient Error is returned", async () => {
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
        expect.objectContaining({ kind: "TRANSIENT" })
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
        expect.objectContaining({ kind: "TRANSIENT" })
      );
    }
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
    expect(mockMessageModel.find).toBeCalledWith([aMessageId, aFiscalCode]);
    expect(mockMessageViewModel.create).toBeCalledWith(
      expect.objectContaining({
        components: {
          attachments: { has: false },
          euCovidCert: { has: false },
          legalData: { has: false },
          payment: { has: false },
          thirdParty: { has: false }
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

  it("GIVEN a valid message_status WHEN the message_view not contains the message THEN the message_status is enriched with a not valid third_party and message_view write fails", async () => {
    mockMessageViewModel.patch.mockReturnValueOnce(
      TE.left(
        CosmosErrorResponse({ code: 404, name: "error", message: "error" })
      )
    );
    mockMessageModel.getContentFromBlob.mockReturnValueOnce(
      TE.right(
        O.some({
          ...aMessageContentWithThirdParty,
          third_party_data: { id: 0 }
        })
      )
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
      expect(result.left.kind).toBe("TRANSIENT");
    }
    expect(mockMessageViewModel.patch).toBeCalledTimes(1);
    expect(mockMessageModel.find).toBeCalledWith([aMessageId, aFiscalCode]);
    expect(mockMessageViewModel.create).not.toHaveBeenCalled();
  });
});

const aMessageViewWithPaymentComponent = pipe(
  MessageView.decode({
    ...aMessageView,
    components: {
      ...aMessageView.components,
      payment: {
        has: true,
        notice_number: "177777777777777777" as PaymentNoticeNumber,
        payment_status: PaymentStatusEnum.NOT_PAID
      }
    }
  }),
  E.getOrElseW(() => {
    throw new Error("Cannot decode MessageView with Payment Component");
  })
);

const aPaymentUpdate: PaymentUpdate = {
  fiscalCode: aMessageView.fiscalCode,
  messageId: aMessageView.id,
  paid: true,
  noticeNumber: "011111111111111111" as PaymentNoticeNumber
};

describe("handlePaymentChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GIVEN a valid payment update WHEN the message_view already contains the message THEN the message_view is updated with payment data from payment update", async () => {
    mockMessageViewModel.find.mockImplementationOnce(() =>
      TE.right(O.some(aMessageViewWithPaymentComponent))
    );

    mockMessageViewModel.upsert.mockImplementationOnce(() => TE.right(void 0));

    const result = await handlePaymentChange(mockMessageViewModel as any)(
      aPaymentUpdate
    )();

    expect(E.isRight(result)).toBeTruthy();
    expect(mockMessageViewModel.upsert).toBeCalledWith({
      ...aMessageViewWithPaymentComponent,
      components: {
        ...aMessageViewWithPaymentComponent.components,
        payment: {
          ...aMessageViewWithPaymentComponent.components.payment,
          notice_number: aPaymentUpdate.noticeNumber,
          payment_status: PaymentStatusEnum.PAID
        }
      }
    });
  });

  it("GIVEN a valid payment update WHEN the message_view does not exists THEN a permanent failure is returned", async () => {
    mockMessageViewModel.find.mockImplementationOnce(() => TE.right(O.none));

    const result = await handlePaymentChange(mockMessageViewModel as any)(
      aPaymentUpdate
    )();

    expect(mockMessageViewModel.upsert).not.toHaveBeenCalled();
    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual({
        kind: "TRANSIENT",
        reason: expect.stringContaining("Message view Not Found")
      });
    }
  });

  it("GIVEN a valid payment update WHEN the message_view cannot be read from cosmos THEN a transient failure is returned", async () => {
    mockMessageViewModel.find.mockImplementationOnce(() =>
      TE.left(Error("Cannot read form collection"))
    );

    const result = await handlePaymentChange(mockMessageViewModel as any)(
      aPaymentUpdate
    )();

    expect(mockMessageViewModel.upsert).not.toHaveBeenCalled();
    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual({
        kind: "TRANSIENT",
        reason: expect.stringContaining("Cannot find Message view")
      });
    }
  });

  it("GIVEN a valid payment update WHEN the message_view cannot be upserted THEN a transient failure is returned", async () => {
    mockMessageViewModel.find.mockImplementationOnce(() =>
      TE.right(O.some(aMessageViewWithPaymentComponent))
    );

    mockMessageViewModel.upsert.mockImplementationOnce(() =>
      TE.left(Error("Cannot upsert model"))
    );

    const result = await handlePaymentChange(mockMessageViewModel as any)(
      aPaymentUpdate
    )();

    expect(mockMessageViewModel.upsert).toHaveBeenCalled();
    expect(mockMessageViewModel.upsert).toHaveBeenCalledWith({
      ...aMessageViewWithPaymentComponent,
      components: {
        ...aMessageViewWithPaymentComponent.components,
        payment: {
          ...aMessageViewWithPaymentComponent.components.payment,
          notice_number: aPaymentUpdate.noticeNumber,
          payment_status: PaymentStatusEnum.PAID
        }
      }
    });
    expect(E.isLeft(result)).toBeTruthy();
    if (E.isLeft(result)) {
      expect(result.left).toEqual({
        kind: "TRANSIENT",
        reason: expect.stringContaining("Cannot Upsert MessageView")
      });
    }
  });
});
