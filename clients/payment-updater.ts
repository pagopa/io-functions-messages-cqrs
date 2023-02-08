import { agent } from "@pagopa/ts-commons";
import { AbortableFetch, setFetchTimeout } from "@pagopa/ts-commons/lib/fetch";
import { Millisecond } from "@pagopa/ts-commons/lib/units";
import nodeFetch from "node-fetch";
import { createClient } from "../generated/payment-updater/client";

import { getConfigOrThrow } from "../utils/config";

const config = getConfigOrThrow();

export const apimBaseUrl = config.APIM_BASE_URL;
export const apimSubscriptionKey = config.APIM_SUBSCRIPTION_KEY;

// 5 seconds timeout by default
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

// this method can be removed after we migrate @pagopa/ts-commons to node 18 so we can use the new
// implementation of  toFetch
// eslint-disable-next-line
const toRemoveToFetch = (f: any) => (
  input: RequestInfo | URL,
  init?: RequestInit
) => f(input, init).e1;

// Must be an https endpoint so we use an https agent
const abortableFetch = AbortableFetch(agent.getHttpsFetch(process.env));
const fetchWithTimeout = toRemoveToFetch(
  setFetchTimeout(DEFAULT_REQUEST_TIMEOUT_MS as Millisecond, abortableFetch)
);
const fetchApi: typeof fetchWithTimeout = (nodeFetch as unknown) as typeof fetchWithTimeout;

export const paymentUpdaterClient = createClient<"SubscriptionKey">({
  baseUrl: apimBaseUrl,
  fetchApi,
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  withDefaults: op => params =>
    op({ SubscriptionKey: apimSubscriptionKey, ...params })
});

export type PaymentUpdaterClient = typeof paymentUpdaterClient;
