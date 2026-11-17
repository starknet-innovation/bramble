/**
 * Validators for the parts of a privacy preparation review that carry fee and
 * authorization facts. Split from ./privacy-runtime so every review crosses
 * the same field guards. Everything the background sends is untrusted here:
 * a field that fails its guard rejects the whole review.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { PaymasterAuthorizationReview } from "@bramble/privacy/paymaster-typed-data";
import { canonicalStrk20PoolFee } from "@bramble/privacy/service";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "@bramble/wallet-model/networks";
import { STRK20_LIMITS } from "@bramble/wallet-protocol/strk20";

/**
 * Reads the capability summary of relay typed data, or null when any field is
 * missing, extra, or out of range.
 */
export const readAuthorization = (value: unknown): PaymasterAuthorizationReview | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["caller", "executeAfter", "executeBefore", "publicCallCount"]) ||
    typeof value["caller"] !== "string" ||
    !isNonZeroStarkFieldElement(value["caller"]) ||
    typeof value["executeAfter"] !== "string" ||
    !isStarkFieldElement(value["executeAfter"]) ||
    typeof value["executeBefore"] !== "string" ||
    !isStarkFieldElement(value["executeBefore"]) ||
    typeof value["publicCallCount"] !== "number" ||
    !Number.isSafeInteger(value["publicCallCount"]) ||
    value["publicCallCount"] < 0 ||
    value["publicCallCount"] > STRK20_LIMITS.actions
  ) {
    return null;
  }
  return {
    caller: value["caller"],
    executeAfter: value["executeAfter"],
    executeBefore: value["executeBefore"],
    publicCallCount: value["publicCallCount"],
  };
};

/** True for a pool fee in canonical form within the pool-fee ceiling. */
export const isPoolFee = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return canonicalStrk20PoolFee(value) === value;
  } catch {
    return false;
  }
};

/**
 * Who pays a sponsored shield's fees, as the review shows them (mc-wallet 789). The
 * estimate is the relay's informational gas figure; the user pays none of it.
 */
export type PrivacySponsor = {
  readonly estimatedNetworkFeeFri?: string;
  readonly name: string;
};

const MAX_SPONSOR_NAME = 64;

/** Reads a sponsor block, or null when it is malformed. */
export const readSponsor = (value: unknown): PrivacySponsor | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["estimatedNetworkFeeFri", "name"]) ||
    typeof value["name"] !== "string" ||
    value["name"].length === 0 ||
    value["name"].length > MAX_SPONSOR_NAME ||
    (value["estimatedNetworkFeeFri"] !== undefined && !isPoolFee(value["estimatedNetworkFeeFri"]))
  ) {
    return null;
  }
  return {
    ...(typeof value["estimatedNetworkFeeFri"] === "string"
      ? { estimatedNetworkFeeFri: value["estimatedNetworkFeeFri"] }
      : {}),
    name: value["name"],
  };
};
