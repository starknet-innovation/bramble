/**
 * Onboarding mnemonic-validity response guard. Split from responses.ts to stay
 * within the size budget. The reply carries only a boolean verdict — never the
 * phrase — so an invalid or malformed background reply cannot leak recovery
 * material into the UI.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { type AccountRef, isAccountId, isAccountRef } from "@bramble/wallet-model/accounts";
import { isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
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

/**
 * One Argent release a raw Ready key controls an address at, as discovery
 * reports it: public address, id and class, plus the evidence that the address
 * is in use. A funded-only row lists what it holds, for display only. Never
 * carries key material.
 */
export type ReadyKeyCandidate =
  | {
      readonly accountId: string;
      readonly address: string;
      readonly classHash: string;
      readonly deployed: true;
    }
  | {
      readonly accountId: string;
      readonly address: string;
      readonly classHash: string;
      readonly deployed: false;
      readonly holdings: readonly { readonly formatted: string; readonly symbol: string }[];
    };

const isShortText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const isFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value);

const isHolding = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["formatted", "symbol"]) &&
  isShortText(value["formatted"], 80) &&
  isShortText(value["symbol"], 16);

const isReadyKeyCandidate = (value: unknown): value is ReadyKeyCandidate => {
  if (!isRecord(value)) return false;
  const common =
    isAccountId(value["accountId"]) && isFelt(value["address"]) && isFelt(value["classHash"]);
  if (value["deployed"] === true) {
    return common && hasOnlyKnownKeys(value, ["accountId", "address", "classHash", "deployed"]);
  }
  return (
    common &&
    value["deployed"] === false &&
    hasOnlyKnownKeys(value, ["accountId", "address", "classHash", "deployed", "holdings"]) &&
    Array.isArray(value["holdings"]) &&
    value["holdings"].length > 0 &&
    value["holdings"].every(isHolding)
  );
};

/** Ready-key discovery: the releases the key controls an address in use at. */
export type ReadyKeyDiscoveryResponse = {
  readonly candidates: readonly ReadyKeyCandidate[];
  readonly ok: true;
};

/** Validates Ready-key discovery before it reaches the picker; at least one row. */
export const isReadyKeyDiscoveryResponse = (value: unknown): value is ReadyKeyDiscoveryResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["candidates", "ok"]) &&
  Array.isArray(value["candidates"]) &&
  value["candidates"].length > 0 &&
  value["candidates"].every(isReadyKeyCandidate) &&
  value["ok"] === true;
