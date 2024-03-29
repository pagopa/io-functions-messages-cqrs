/**
 * Config module
 *
 * Single point of access for the application confguration. Handles validation on required environment variables.
 * The configuration is evaluate eagerly at the first access to the module. The module exposes convenient methods to access such value.
 */

import * as t from "io-ts";

import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/lib/function";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";

import { AzureEventhubSasFromString } from "@pagopa/fp-ts-kafkajs/dist/lib/KafkaProducerCompact";
import { withDefault } from "@pagopa/ts-commons/lib/types";
import {
  NonNegativeInteger,
  NonNegativeIntegerFromString,
  NumberFromString
} from "@pagopa/ts-commons/lib/numbers";

export const MessageChangeFeedConfig = t.type({
  MESSAGE_CHANGE_FEED_LEASE_PREFIX: NonEmptyString,
  MESSAGE_CHANGE_FEED_START_TIME: withDefault(NumberFromString, 0)
});
export type MessageChangeFeedConfig = t.TypeOf<typeof MessageChangeFeedConfig>;
// global app configuration
export type IConfig = t.TypeOf<typeof IConfig>;
export const IConfig = t.intersection([
  t.type({
    APIM_BASE_URL: NonEmptyString,
    APIM_SUBSCRIPTION_KEY: NonEmptyString,
    APPINSIGHTS_INSTRUMENTATIONKEY: NonEmptyString,

    AzureWebJobsStorage: NonEmptyString,

    COSMOSDB_CONNECTION_STRING: NonEmptyString,
    COSMOSDB_KEY: NonEmptyString,
    COSMOSDB_NAME: NonEmptyString,
    COSMOSDB_URI: NonEmptyString,

    INTERNAL_STORAGE_CONNECTION_STRING: NonEmptyString,

    MESSAGES_TOPIC_CONNECTION_STRING: AzureEventhubSasFromString,
    MESSAGE_CONFIGURATION_CHANGE_FEED_START_TIME: NonNegativeInteger,
    MESSAGE_CONTENT_STORAGE_CONNECTION: NonEmptyString,
    MESSAGE_PAYMENT_UPDATER_FAILURE_QUEUE_NAME: NonEmptyString,

    MESSAGE_STATUS_FOR_REMINDER_TOPIC_PRODUCER_CONNECTION_STRING: AzureEventhubSasFromString,
    MESSAGE_STATUS_FOR_VIEW_BROKERS: NonEmptyString,
    MESSAGE_STATUS_FOR_VIEW_TOPIC_CONSUMER_CONNECTION_STRING: AzureEventhubSasFromString,
    MESSAGE_STATUS_FOR_VIEW_TOPIC_CONSUMER_GROUP: NonEmptyString,
    MESSAGE_STATUS_FOR_VIEW_TOPIC_NAME: NonEmptyString,
    MESSAGE_STATUS_FOR_VIEW_TOPIC_PRODUCER_CONNECTION_STRING: AzureEventhubSasFromString,

    MESSAGE_VIEW_PAYMENT_UPDATE_FAILURE_QUEUE_NAME: NonEmptyString,
    MESSAGE_VIEW_UPDATE_FAILURE_QUEUE_NAME: NonEmptyString,
    PN_SERVICE_ID: NonEmptyString,

    QueueStorageConnection: NonEmptyString,

    REMOTE_CONTENT_COSMOSDB_KEY: NonEmptyString,
    REMOTE_CONTENT_COSMOSDB_NAME: NonEmptyString,
    REMOTE_CONTENT_COSMOSDB_URI: NonEmptyString,

    isProduction: t.boolean
  }),
  MessageChangeFeedConfig
]);

export const envConfig = {
  ...process.env,

  MESSAGE_CONFIGURATION_CHANGE_FEED_START_TIME: pipe(
    process.env.MESSAGE_CONFIGURATION_CHANGE_FEED_START_TIME,
    NonNegativeIntegerFromString.decode,
    E.getOrElse(() => 0 as NonNegativeInteger)
  ),

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
