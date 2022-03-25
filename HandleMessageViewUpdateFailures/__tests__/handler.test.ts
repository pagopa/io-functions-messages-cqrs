import * as util from "../../utils/message_view";
import * as TE from "fp-ts/lib/TaskEither";
import { HandleMessageViewUpdateFailureHandler } from "../handler";
import { Context } from "@azure/functions";
import { HandleMessageViewFailureInput } from "../../utils/message_view";
import { aMessageStatus } from "../../__mocks__/message";
import { TelemetryClient } from "../../utils/appinsights";
import { TransientFailure } from "../../utils/errors";
import { pipe } from "fp-ts/lib/function";
import { toError } from "fp-ts/lib/Either";

const functionsContextMock = ({
  log: {
    error: jest.fn(console.log)
  }
} as unknown) as Context;

const telemetryClientMock = ({
  trackException: jest.fn(_ => void 0)
} as unknown) as TelemetryClient;

const handleStatusChangeMock = jest
  .fn()
  .mockImplementation(() => TE.of(void 0));
jest
  .spyOn(util, "handleStatusChange")
  .mockImplementation(handleStatusChangeMock);

const inputMessage = {
  body: {
    ...aMessageStatus
  },
  message: "aMessage"
};

const aRetriableInput: HandleMessageViewFailureInput = {
  ...inputMessage,
  retriable: true
};

const aNotRetriableInput: HandleMessageViewFailureInput = {
  ...inputMessage,
  retriable: false
};

const aTransientFailure: TransientFailure = {
  kind: "TRANSIENT",
  reason: "aReason"
};
const anyParam = {} as any;

describe("HandleMessageViewUpdateFailureHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it("shoud return a Permanent failure if input decode fails", async () => {
    pipe(
      TE.tryCatch(
        () =>
          HandleMessageViewUpdateFailureHandler(
            functionsContextMock,
            { wrongInput: true },
            telemetryClientMock,
            anyParam,
            anyParam,
            anyParam
          ),
        toError
      ),
      TE.bimap(
        () => fail,
        result => {
          expect(result).toEqual(
            expect.objectContaining({
              kind: "PERMANENT"
            })
          );
          expect(telemetryClientMock.trackException).toHaveBeenCalled();
        }
      )
    );
  });

  it("shoud return a Permanent failure if input is not retriable", async () => {
    pipe(
      TE.tryCatch(
        () =>
          HandleMessageViewUpdateFailureHandler(
            functionsContextMock,
            aNotRetriableInput,
            telemetryClientMock,
            anyParam,
            anyParam,
            anyParam
          ),
        toError
      ),
      TE.bimap(
        () => fail,
        result => {
          expect(result).toEqual(
            expect.objectContaining({
              kind: "PERMANENT"
            })
          );
          expect(telemetryClientMock.trackException).toHaveBeenCalled();
        }
      )
    );
  });

  it("shoud throw if Transient failure occurs", async () => {
    handleStatusChangeMock.mockImplementationOnce(() =>
      TE.left(aTransientFailure)
    );
    pipe(
      TE.tryCatch(
        () =>
          HandleMessageViewUpdateFailureHandler(
            functionsContextMock,
            aRetriableInput,
            telemetryClientMock,
            anyParam,
            anyParam,
            anyParam
          ),
        toError
      ),
      TE.bimap(
        () => {
          expect(telemetryClientMock.trackException).toHaveBeenCalledWith(
            telemetryClientMock,
            expect.objectContaining({
              tagOverrides: { samplingEnabled: "false" }
            })
          );
        },
        () => fail
      )
    );
  });

  it("shoud return void if everything works fine", async () => {
    pipe(
      TE.tryCatch(
        () =>
          HandleMessageViewUpdateFailureHandler(
            functionsContextMock,
            aRetriableInput,
            telemetryClientMock,
            anyParam,
            anyParam,
            anyParam
          ),
        toError
      ),
      TE.bimap(
        () => fail,
        result => {
          expect(telemetryClientMock.trackException).not.toHaveBeenCalled();
          expect(result).toEqual(void 0);
        }
      )
    );
  });
});
