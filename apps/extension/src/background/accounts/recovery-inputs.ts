/**
 * Parser for the recovery submit messages. Untrusted extension-page input: the
 * exact key set, a confirmed fee, the account the confirmation was reviewed
 * for, and — Ready only — the confirmed step and an explicit owner-escape
 * acknowledgement (only `true` is accepted; absence means "not acknowledged").
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import { isAccountId } from "@bramble/wallet-model/accounts";

/** A validated recovery submit request. */
export type RecoveryInput = {
  readonly accountId: string;
  readonly replaceOwnerEscape: boolean;
  readonly reviewedFee: FeeEstimate;
  readonly step?: "complete" | "start";
};

/**
 * Parses a recovery submit message of `type`, or returns null. The Braavos
 * request takes no step and no owner-escape flag; the Ready request requires
 * a step (checked by its handler).
 */
export const readRecoveryInput = (
  message: unknown,
  type: "wallet.recoverArgentAccount" | "wallet.recoverBraavosAccount",
): RecoveryInput | null => {
  const argent = type === "wallet.recoverArgentAccount";
  const keys = argent
    ? ["accountId", "replaceOwnerEscape", "reviewedFee", "step", "type"]
    : ["accountId", "reviewedFee", "type"];
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, keys) ||
    message["type"] !== type ||
    !isAccountId(message["accountId"]) ||
    !isFeeEstimate(message["reviewedFee"])
  ) {
    return null;
  }
  const step = message["step"];
  const replace = message["replaceOwnerEscape"];
  if (step !== undefined && step !== "start" && step !== "complete") return null;
  if (replace !== undefined && replace !== true) return null;
  return {
    accountId: message["accountId"],
    replaceOwnerEscape: replace === true,
    reviewedFee: message["reviewedFee"],
    ...(step !== undefined ? { step } : {}),
  };
};
