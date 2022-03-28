import * as t from "io-ts";
import * as O from "fp-ts/lib/Option";
import { pipe } from "fp-ts/lib/function";
import { Context } from "@azure/functions";
import { TelemetryClient, trackException } from "./appinsights";

export const TransientFailure = t.interface({
  kind: t.literal("TRANSIENT"),
  reason: t.string
});
export type TransientFailure = t.TypeOf<typeof TransientFailure>;

export const PermanentFailure = t.interface({
  kind: t.literal("PERMANENT"),
  reason: t.string
});
export type PermanentFailure = t.TypeOf<typeof PermanentFailure>;

export const Failure = t.intersection([
  t.union([TransientFailure, PermanentFailure]),
  t.partial({ modelId: t.string })
]);
export type Failure = t.TypeOf<typeof Failure>;

export const toTransientFailure = (err: Error, customReason?: string) => (
  modelId?: string
): Failure =>
  pipe(
    customReason,
    O.fromNullable,
    O.map(reason => `ERROR=${reason} DETAIL=${err.message}`),
    O.getOrElse(() => `ERROR=${err.message}`),
    errorMsg =>
      Failure.encode({
        kind: "TRANSIENT",
        modelId,
        reason: `TRANSIENT FAILURE|${errorMsg}`
      })
  );

export const toPermanentFailure = (err: Error, customReason?: string) => (
  modelId?: string
): Failure =>
  pipe(
    customReason,
    O.fromNullable,
    O.map(reason => `ERROR=${reason} DETAIL=${err.message}`),
    O.getOrElse(() => `ERROR=${err.message}`),
    errorMsg =>
      Failure.encode({
        kind: "PERMANENT",
        modelId,
        reason: `PERMANENT FAILURE|${errorMsg}`
      })
  );

export const trackFailure = (
  telemetryClient: TelemetryClient,
  context: Context,
  logPrefix: string
) => (err: Failure): Failure => {
  const error = TransientFailure.is(err)
    ? `${logPrefix}|TRANSIENT_ERROR=${err.reason}`
    : `${logPrefix}|FATAL|PERMANENT_ERROR=${err.reason}`;
  trackException(telemetryClient, {
    exception: new Error(error),
    properties: {
      detail: err.kind,
      fatal: PermanentFailure.is(err).toString(),
      isSuccess: "false",
      name: `cgn.exception.${logPrefix}.failure`
    }
  });
  context.log.error(error);
  if (TransientFailure.is(err)) {
    throw new Error(err.reason);
  }
  return err;
};
