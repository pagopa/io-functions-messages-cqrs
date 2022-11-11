/**
 * Config module
 *
 * Single point of access for the application confguration. Handles validation on required environment variables.
 * The configuration is evaluate eagerly at the first access to the module. The module exposes convenient methods to access such value.
 */

import * as t from "io-ts";

import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/lib/function";
import * as R from "fp-ts/Record";
import * as S from "fp-ts/string";
import { set } from "lodash";

import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";

import { KafkaProducerCompactConfig } from "@pagopa/fp-ts-kafkajs/dist/lib/IoKafkaTypes";
import { AzureEventhubSasFromString } from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";

const isStringKeysRecord = (i: unknown): i is Record<string, unknown> =>
  typeof i === "object" &&
  i !== null &&
  !Object.keys(i).some(property => typeof property !== "string");

const createNotStringKeysRecordErrorL = (
  input: unknown,
  context: t.Context
) => (): t.Errors => [
  {
    context,
    message: "input is not a valid string keys record",
    value: input
  }
];

/**
 * This functions create an object containig only the properties starting with 'prefix'. The env properties name will be splited using '_' to create nested object.
 * eg. TARGETKAFKA_client_id: 1234 => { client: { id: 1234 } }
 *
 * @param env the input env
 * @param prefix the properties prefix
 * @returns a object
 */
export const nestifyPrefixedType = (
  env: Record<string, unknown>,
  prefix: string
): Record<string, unknown> =>
  pipe(
    env,
    R.filterWithIndex(fieldName => fieldName.split("_")[0] === prefix),
    R.reduceWithIndex(S.Ord)({}, (k, b, a) =>
      set(
        b,
        // eslint-disable-next-line functional/immutable-data
        k
          .split("_")
          .splice(1)
          .join("."),
        a
      )
    )
  );

export type KafkaProducerCompactConfig = t.TypeOf<
  typeof KafkaProducerCompactConfig
>;
export const KafkaProducerCompactConfigFromEnv = new t.Type<
  KafkaProducerCompactConfig,
  KafkaProducerCompactConfig,
  unknown
>(
  "KafkaProducerCompactConfigFromEnv",
  (u: unknown): u is KafkaProducerCompactConfig =>
    KafkaProducerCompactConfig.is(u),
  (input, context) =>
    pipe(
      input,
      E.fromPredicate(
        isStringKeysRecord,
        createNotStringKeysRecordErrorL(input, context)
      ),
      E.chainW(inputRecord =>
        KafkaProducerCompactConfig.validate(
          nestifyPrefixedType(inputRecord, "TARGETKAFKA"),
          context
        )
      )
    ),
  t.identity
);
// global app configuration
export type IDecodableConfig = t.TypeOf<typeof IDecodableConfig>;
// eslint-disable-next-line @typescript-eslint/ban-types
export const IDecodableConfig = t.interface({
  APIM_BASE_URL: NonEmptyString,
  APIM_SUBSCRIPTION_KEY: NonEmptyString,
  APPINSIGHTS_INSTRUMENTATIONKEY: NonEmptyString,

  AzureWebJobsStorage: NonEmptyString,

  COSMOSDB_CONNECTION_STRING: NonEmptyString,
  COSMOSDB_KEY: NonEmptyString,
  COSMOSDB_NAME: NonEmptyString,
  COSMOSDB_URI: NonEmptyString,

  INTERNAL_STORAGE_CONNECTION_STRING: NonEmptyString,

  MESSAGE_CONTENT_STORAGE_CONNECTION: NonEmptyString,
  MESSAGE_PAYMENT_UPDATER_FAILURE_QUEUE_NAME: NonEmptyString,

  MESSAGE_STATUS_FOR_REMINDER_TOPIC_PRODUCER_CONNECTION_STRING: AzureEventhubSasFromString,
  MESSAGE_STATUS_FOR_VIEW_BROKERS: NonEmptyString,
  MESSAGE_STATUS_FOR_VIEW_TOPIC_CONSUMER_CONNECTION_STRING: NonEmptyString,
  MESSAGE_STATUS_FOR_VIEW_TOPIC_CONSUMER_GROUP: NonEmptyString,
  MESSAGE_STATUS_FOR_VIEW_TOPIC_NAME: NonEmptyString,
  MESSAGE_STATUS_FOR_VIEW_TOPIC_PRODUCER_CONNECTION_STRING: NonEmptyString,

  MESSAGE_VIEW_PAYMENT_UPDATE_FAILURE_QUEUE_NAME: NonEmptyString,
  MESSAGE_VIEW_UPDATE_FAILURE_QUEUE_NAME: NonEmptyString,
  PN_SERVICE_ID: NonEmptyString,
  QueueStorageConnection: NonEmptyString,

  isProduction: t.boolean
});

const MessagesKafkaTopicConfig = t.type({
  MESSAGES_TOPIC_CONNECTION_STRING: NonEmptyString,
  MESSAGES_TOPIC_NAME: NonEmptyString
});
type MessagesKafkaTopicConfig = t.TypeOf<typeof MessagesKafkaTopicConfig>;

export interface IParsableConfig {
  readonly targetKafka: KafkaProducerCompactConfig;

  readonly MessagesKafkaTopicConfig: MessagesKafkaTopicConfig;
}

export const parseConfig = (input: unknown): t.Validation<IParsableConfig> =>
  pipe(
    E.Do,
    E.bind("targetKafka", () =>
      KafkaProducerCompactConfigFromEnv.decode(input)
    ),
    E.bind("MessagesKafkaTopicConfig", () =>
      MessagesKafkaTopicConfig.decode(input)
    )
  );

export type IConfig = IDecodableConfig & IParsableConfig;
export const IConfig = new t.Type<IConfig>(
  "IConfig",
  (u: unknown): u is IConfig => IDecodableConfig.is(u),
  (input, context) =>
    pipe(
      E.Do,
      E.bind("dc", () => IDecodableConfig.validate(input, context)),
      E.bind("pc", () => parseConfig(input)),
      E.map(({ dc, pc }) => ({ ...dc, ...pc }))
    ),
  t.identity
);

export const envConfig = {
  ...process.env,
  isProduction: process.env.NODE_ENV === "production"
};

// No need to re-evaluate this object for each call
const errorOrConfig: t.Validation<IConfig> = IConfig.decode(envConfig);

/**
 * Read the application configuration and check for invalid values.
 * Configuration is eagerly evalued when the application starts.
 *
 * @returns either the configuration values or a list of validation errors
 */
export const getConfig = (): t.Validation<IConfig> => errorOrConfig;

/**
 * Read the application configuration and check for invalid values.
 * If the application is not valid, raises an exception.
 *
 * @returns the configuration values
 * @throws validation errors found while parsing the application configuration
 */
export const getConfigOrThrow = (): IConfig =>
  pipe(
    errorOrConfig,
    E.getOrElseW((errors: ReadonlyArray<t.ValidationError>) => {
      throw new Error(`Invalid configuration: ${readableReport(errors)}`);
    })
  );
