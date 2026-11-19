/**
 * Strict runtime client for Settings > Experimental features: reads the
 * effective feature flags and sets or clears the user's local overrides.
 *
 * The background is the authority: it decides which flags are overridable,
 * refuses changes while locked, and keeps a remote hard kill above any
 * override. Every reply is validated here before it reaches render state, and
 * a malformed one is reported as unavailable rather than rendered.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { responseError } from "../../runtime/runtime-errors";

// Bounds a reply before it renders; the catalog is a handful of flags.
const MAX_FLAGS = 64;
const MAX_FLAG_KEY_LENGTH = 64;

/** What the Experimental features screen shows. */
export type ExperimentalFeatures = {
  /** Effective value per known flag. */
  readonly flags: Readonly<Record<string, boolean>>;
  /** Overridable flags the publisher has turned off; overrides are ignored. */
  readonly killed: readonly string[];
  /** Flags this build lets the user override, sorted. */
  readonly overridable: readonly string[];
  /** Flags whose value currently comes from the user's override. */
  readonly overridden: readonly string[];
};

/** The screen's state: the read, not landed yet, or failed. */
export type ExperimentalFeaturesState = ExperimentalFeatures | "error" | "loading";

const isFlagKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_FLAG_KEY_LENGTH;

const isKeyList = (value: unknown, flags: Record<string, unknown>): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= MAX_FLAGS &&
  value.every((key) => isFlagKey(key) && Object.hasOwn(flags, key)) &&
  new Set(value).size === value.length;

// Validates a `wallet.featureFlags`-shaped reply; null when malformed.
const readExperimentalFeatures = (response: unknown): ExperimentalFeatures | null => {
  if (
    !isRecord(response) ||
    !hasOnlyKnownKeys(response, [
      "flags",
      "killed",
      "ok",
      "overridable",
      "overridden",
      "sequence",
      "source",
    ]) ||
    response["ok"] !== true ||
    !isRecord(response["flags"])
  ) {
    return null;
  }
  const flags = response["flags"];
  const entries = Object.entries(flags);
  if (
    entries.length > MAX_FLAGS ||
    !entries.every(([key, value]) => isFlagKey(key) && typeof value === "boolean") ||
    !isKeyList(response["killed"], flags) ||
    !isKeyList(response["overridable"], flags) ||
    !isKeyList(response["overridden"], flags)
  ) {
    return null;
  }
  return {
    flags: Object.fromEntries(entries) as Record<string, boolean>,
    killed: response["killed"],
    overridable: response["overridable"],
    overridden: response["overridden"],
  };
};

/**
 * Creates the Experimental features client. Each method throws a
 * reviewed-copy error when the background refuses or answers malformed.
 */
export const createExperimentalFeaturesClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => {
  const expect = (response: unknown, code: string): ExperimentalFeatures => {
    const features = readExperimentalFeatures(response);
    if (features === null) throw responseError(response, code);
    return features;
  };
  return {
    async loadExperimentalFeatures(): Promise<ExperimentalFeatures> {
      return expect(
        await sendMessage({ type: "wallet.featureFlags" }),
        "feature flags unavailable",
      );
    },
    /** Sets a flag on or off, or back to its default with `null`. */
    async setExperimentalFeature(
      key: string,
      value: boolean | null,
    ): Promise<ExperimentalFeatures> {
      return expect(
        await sendMessage({ key, type: "wallet.setFeatureFlagOverride", value }),
        "feature flag overrides unavailable",
      );
    },
    async resetExperimentalFeatures(): Promise<ExperimentalFeatures> {
      return expect(
        await sendMessage({ type: "wallet.clearFeatureFlagOverrides" }),
        "feature flag overrides unavailable",
      );
    },
  };
};
