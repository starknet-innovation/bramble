/** Public account-recovery coordinates and bounded discovery results. */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import {
  type AccountContractType,
  type DerivedAccountRef,
  isAccountContractType,
  isDerivedAccountRef,
} from "./accounts";

/** Shared recovery bounds consumed by input validation, scanning, and UI. */
export const RECOVERY_SCAN_LIMITS = {
  batchSize: 4,
  defaultCount: 20,
  maxIndex: 0x7fffffff,
  maxSelections: 40,
} as const;

/** One HD coordinate selected for restoration into the encrypted vault. */
export type RecoveryAccountSelection = {
  readonly accountContractType: AccountContractType;
  readonly accountIndex: number;
};

/** One derived account and the chain evidence that made it discoverable. */
export type RecoveryAccountCandidate = {
  readonly account: DerivedAccountRef;
  readonly deployed: boolean;
  readonly funded: boolean;
};

/** True for a valid hardened BIP-44 account index. */
export const isRecoveryAccountIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= RECOVERY_SCAN_LIMITS.maxIndex;

/** Validates one exact recovery coordinate at a runtime boundary. */
export const isRecoveryAccountSelection = (value: unknown): value is RecoveryAccountSelection =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountContractType", "accountIndex"]) &&
  isAccountContractType(value["accountContractType"]) &&
  isRecoveryAccountIndex(value["accountIndex"]);

/** Validates one public discovery result before caching or rendering it. */
export const isRecoveryAccountCandidate = (value: unknown): value is RecoveryAccountCandidate =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["account", "deployed", "funded"]) &&
  isDerivedAccountRef(value["account"]) &&
  typeof value["deployed"] === "boolean" &&
  typeof value["funded"] === "boolean";
