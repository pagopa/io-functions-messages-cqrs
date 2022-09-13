import * as winston from "winston";
import { Context } from "@azure/functions";
import { AzureContextTransport } from "@pagopa/io-functions-commons/dist/src/utils/logging";
import { fromConfig } from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import { ValidableKafkaProducerConfig } from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaTypes";
import { getConfigOrThrow } from "../utils/config";
import { jsonMessageStatusFormatter } from "../utils/formatter/messageStatusJsonFormatter";
import { handleMessageStatusChangeFeedForView } from "./handler";

// eslint-disable-next-line functional/no-let
let logger: Context["log"] | undefined;
const contextTransport = new AzureContextTransport(() => logger, {
  level: "debug"
});
winston.add(contextTransport);

const config = getConfigOrThrow();

const messageStatusConfig = {
  // TODO override conf
  ...config.targetKafka,
  brokers: [config.MESSAGE_STATUS_FOR_VIEW_BROKERS],
  sasl: {
    ...config.targetKafka.sasl,
    password: config.MESSAGE_STATUS_FOR_VIEW_TOPIC_PRODUCER_CONNECTION_STRING
  },
  topic: config.MESSAGE_STATUS_FOR_VIEW_TOPIC_NAME
};

const messageStatusTopic = {
  ...messageStatusConfig,
  messageFormatter: jsonMessageStatusFormatter()
};

const kafkaClient = fromConfig(
  messageStatusConfig as ValidableKafkaProducerConfig, // cast due to wrong association between Promise<void> and t.Function ('brokers' field)
  messageStatusTopic
);

const run = async (
  context: Context,
  rawMessageStatus: ReadonlyArray<unknown>
): Promise<void> => {
  logger = context.log;
  return handleMessageStatusChangeFeedForView(
    context,
    rawMessageStatus,
    kafkaClient
  );
};

export default run;
