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
  readonly replaceEscape?: {
    readonly kind: "guardian-change" | "owner-escape";
    readonly readyAt: number;
  };
  readonly reviewedFee: FeeEstimate;
  readonly step?: "complete" | "start";
};

// The acknowledged escape: exactly its kind and a positive whole ready_at.
const isReplacedEscape = (value: unknown): value is RecoveryInput["replaceEscape"] =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["kind", "readyAt"]) &&
  (value["kind"] === "owner-escape" || value["kind"] === "guardian-change") &&
  typeof value["readyAt"] === "number" &&
  Number.isSafeInteger(value["readyAt"]) &&
  value["readyAt"] > 0;

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
    ? ["accountId", "replaceEscape", "reviewedFee", "step", "type"]
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
  const replace = message["replaceEscape"];
  if (step !== undefined && step !== "start" && step !== "complete") return null;
  if (replace !== undefined && !isReplacedEscape(replace)) return null;
  return {
    accountId: message["accountId"],
    ...(replace !== undefined ? { replaceEscape: replace } : {}),
    reviewedFee: message["reviewedFee"],
    ...(step !== undefined ? { step } : {}),
  };
};
