import * as winston from "winston";
import { Context } from "@azure/functions";
import { AzureContextTransport } from "@pagopa/io-functions-commons/dist/src/utils/logging";
import { RetrievedMessageStatus } from "@pagopa/io-functions-commons/dist/src/models/message_status";
import { pipe } from "fp-ts/lib/function";
import * as RA from "fp-ts/ReadonlyArray";

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
  // eslint-disable-next-line functional/immutable-data
  context.bindings.outputMessageStatus = pipe(
    rawMessageStatus,
    RA.map(RetrievedMessageStatus.decode),
    RA.rights,
    RA.map(JSON.stringify)
  );
  context.done();
};

export default run;
