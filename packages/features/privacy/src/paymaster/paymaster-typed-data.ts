/**
 * SNIP-9 outside-execution validation for paymaster-provided public approval
 * calls. A remote paymaster is untrusted: the wallet reconstructs the standard
 * typed data from the exact requested calls and signs only when both hashes
 * match.
 */

import { isRecord } from "@bramble/core/json";
import { isNonZeroStarkFieldElement, sameFelt } from "@bramble/wallet-model/networks";
import {
  type BigNumberish,
  type Call,
  OutsideExecutionVersion,
  outsideExecution,
  type TypedData,
  typedData,
} from "starknet";

type OutsideFields = {
  readonly caller: BigNumberish;
  readonly executeAfter: BigNumberish;
  readonly executeBefore: BigNumberish;
  readonly nonce: BigNumberish;
  readonly version: "1" | "2";
};

const MAX_U64 = (1n << 64n) - 1n;
const MIN_QUOTE_LIFETIME_SECONDS = 30n;

/**
 * Canonical typed data plus the public capability fields that must be visible
 * in the wallet review before signing.
 */
export type PaymasterAuthorizationReview = {
  readonly caller: string;
  readonly executeAfter: string;
  readonly executeBefore: string;
  readonly publicCallCount: number;
};

/**
 * Canonical outside-execution data and its review-safe capability summary.
 */
export type BoundPaymasterTypedData = {
  readonly review: PaymasterAuthorizationReview;
  readonly typedData: TypedData;
};

/**
 * Checks the SNIP-9 u64 execution window against an injected Unix clock.
 */
export const isPaymasterAuthorizationLive = (
  authorization: PaymasterAuthorizationReview,
  nowSeconds: number,
  minimumRemainingSeconds = 0n,
): boolean => {
  try {
    const after = BigInt(authorization.executeAfter);
    const before = BigInt(authorization.executeBefore);
    const now = BigInt(nowSeconds);
    return (
      Number.isSafeInteger(nowSeconds) &&
      nowSeconds >= 0 &&
      after >= 0n &&
      before <= MAX_U64 &&
      after < now &&
      now < before &&
      before - now >= minimumRemainingSeconds
    );
  } catch {
    return false;
  }
};

const isJsonNumberish = (value: unknown): value is string | number =>
  typeof value === "string" ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

const fieldsFrom = (value: unknown): OutsideFields | null => {
  if (
    !isRecord(value) ||
    value["primaryType"] !== "OutsideExecution" ||
    !isRecord(value["domain"]) ||
    !isRecord(value["message"])
  ) {
    return null;
  }
  const version = value["domain"]["version"];
  const message = value["message"];
  if (version === "1") {
    return isJsonNumberish(message["caller"]) &&
      isJsonNumberish(message["nonce"]) &&
      isJsonNumberish(message["execute_after"]) &&
      isJsonNumberish(message["execute_before"])
      ? {
          caller: message["caller"],
          executeAfter: message["execute_after"],
          executeBefore: message["execute_before"],
          nonce: message["nonce"],
          version,
        }
      : null;
  }
  if (version === "2") {
    return isJsonNumberish(message["Caller"]) &&
      isJsonNumberish(message["Nonce"]) &&
      isJsonNumberish(message["Execute After"]) &&
      isJsonNumberish(message["Execute Before"])
      ? {
          caller: message["Caller"],
          executeAfter: message["Execute After"],
          executeBefore: message["Execute Before"],
          nonce: message["Nonce"],
          version,
        }
      : null;
  }
  return null;
};

/**
 * Returns canonical SNIP-9 typed data only when the untrusted response commits
 * to the active chain, account, and exact public approval calls. Invalid or
 * semantically substituted envelopes return null and must never be signed.
 */
export const bindPaymasterTypedData = (input: {
  readonly accountAddress: string;
  readonly calls: readonly Call[];
  readonly chainId: string;
  readonly nowSeconds: number;
  readonly value: unknown;
}): BoundPaymasterTypedData | null => {
  const fields = fieldsFrom(input.value);
  if (!fields) {
    return null;
  }
  try {
    const caller = String(fields.caller);
    const executeAfter = String(fields.executeAfter);
    const executeBefore = String(fields.executeBefore);
    const review = {
      caller,
      executeAfter,
      executeBefore,
      publicCallCount: input.calls.length,
    };
    if (
      !isNonZeroStarkFieldElement(caller) ||
      !isPaymasterAuthorizationLive(review, input.nowSeconds, MIN_QUOTE_LIFETIME_SECONDS)
    ) {
      return null;
    }
    const expected = outsideExecution.getTypedData(
      input.chainId,
      {
        caller,
        execute_after: fields.executeAfter,
        execute_before: fields.executeBefore,
      },
      fields.nonce,
      [...input.calls],
      fields.version === "1" ? OutsideExecutionVersion.V1 : OutsideExecutionVersion.V2,
    );
    const suppliedHash = typedData.getMessageHash(
      input.value as unknown as TypedData,
      input.accountAddress,
    );
    const expectedHash = typedData.getMessageHash(expected, input.accountAddress);
    return sameFelt(suppliedHash, expectedHash)
      ? {
          review,
          typedData: expected,
        }
      : null;
  } catch {
    return null;
  }
};
