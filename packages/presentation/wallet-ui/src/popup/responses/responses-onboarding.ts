/**
 * Onboarding mnemonic-validity response guard. Split from responses.ts to stay
 * within the size budget. The reply carries only a boolean verdict — never the
 * phrase — so an invalid or malformed background reply cannot leak recovery
 * material into the UI.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { type AccountRef, isAccountRef } from "@bramble/wallet-model/accounts";
import {
  isRecoveryAccountCandidate,
  isRecoveryAccountIndex,
  type RecoveryAccountCandidate,
} from "@bramble/wallet-model/recovery";

/**
 * Popup mnemonic-validity response accepted from the background boundary.
 * Carries only the boolean verdict — never the phrase.
 */
export type ValidateMnemonicResponse = {
  readonly ok: true;
  readonly valid: boolean;
};

/**
 * Checks mnemonic-validity responses before gating onboarding Continue.
 */
export const isValidateMnemonicResponse = (value: unknown): value is ValidateMnemonicResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["ok", "valid"]) &&
  value["ok"] === true &&
  typeof value["valid"] === "boolean";

/** One cached batch of public recovery discovery. */
export type RecoveryDiscoveryResponse = {
  readonly candidates: readonly RecoveryAccountCandidate[];
  readonly complete: boolean;
  readonly nextIndex: number;
  readonly ok: true;
};

/** Validates public recovery discovery before it reaches the account picker. */
export const isRecoveryDiscoveryResponse = (value: unknown): value is RecoveryDiscoveryResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["candidates", "complete", "nextIndex", "ok"]) &&
  Array.isArray(value["candidates"]) &&
  value["candidates"].every(isRecoveryAccountCandidate) &&
  typeof value["complete"] === "boolean" &&
  isRecoveryAccountIndex(value["nextIndex"]) &&
  value["ok"] === true;

/** One account found by its pasted address (issue 398). */
export type AddressLookupResponse = {
  readonly candidate: RecoveryAccountCandidate;
  readonly ok: true;
};

/**
 * Validates an import-by-address answer: one public candidate, marked as found
 * by address so its pick carries the address the chain reported.
 */
export const isAddressLookupResponse = (value: unknown): value is AddressLookupResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["candidate", "ok"]) &&
  isRecoveryAccountCandidate(value["candidate"]) &&
  value["candidate"].byAddress === true &&
  value["ok"] === true;

/** Successful atomic restoration response. */
export type RecoveredAccountsResponse = {
  readonly accounts: readonly AccountRef[];
  readonly ok: true;
};

/** Validates the public accounts returned after the encrypted vault commit. */
export const isRecoveredAccountsResponse = (value: unknown): value is RecoveredAccountsResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accounts", "ok"]) &&
  Array.isArray(value["accounts"]) &&
  value["accounts"].every(isAccountRef) &&
  value["ok"] === true;
