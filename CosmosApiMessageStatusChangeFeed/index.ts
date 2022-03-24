import * as winston from "winston";
import { Context } from "@azure/functions";
import { AzureContextTransport } from "@pagopa/io-functions-commons/dist/src/utils/logging";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { pipe } from "fp-ts/lib/function";
import * as RA from "fp-ts/ReadonlyArray";
import * as E from "fp-ts/Either";

// eslint-disable-next-line functional/no-let
let logger: Context["log"] | undefined;
const contextTransport = new AzureContextTransport(() => logger, {
  level: "debug"
});
winston.add(contextTransport);

const run = async (
  context: Context,
  rawMessageStatus: ReadonlyArray<unknown>
): Promise<void> => {
  logger = context.log;
  pipe(
    rawMessageStatus,
    RA.map(raw =>
      pipe(
        raw,
        RetrievedMessageStatus.decode,
        E.map(messageStatus =>
          context.bindings.outputEventHubMessage.push(messageStatus)
        )
      )
    )
  );
  context.done();
};

export default run;
