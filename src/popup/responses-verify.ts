/**
 * Popup validator for the on-chain class-hash verification response. Parses the
 * discriminated {@link ClassHashVerification} outcome at the UI boundary,
 * rejecting any shape that does not exactly match one variant so a malformed
 * payload can never be read as a "verified" result.
 */
import { hasOnlyKnownKeys, isJson, isRecord } from "../shared/json";
import type { ClassHashVerification } from "../starknet/class-hash-verify";
import { asFelt } from "../starknet/networks";
import { isAccountId } from "../storage/vault-schema";

/**
 * Popup on-chain class-hash verification accepted from the background boundary.
 * The `verification` field is the discriminated {@link ClassHashVerification}
 * outcome, parsed into its precise type at this boundary.
 */
export type ClassHashVerificationResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly verification: ClassHashVerification;
};

const isFeltString = (value: unknown): value is string =>
  typeof value === "string" && asFelt(value) !== null;

const isClassHashVerification = (value: unknown): value is ClassHashVerification => {
  if (!isRecord(value)) {
    return false;
  }
  switch (value["status"]) {
    case "verified":
      return (
        hasOnlyKnownKeys(value, ["onChainClassHash", "status"]) &&
        isFeltString(value["onChainClassHash"])
      );
    case "mismatch":
      return (
        hasOnlyKnownKeys(value, ["expectedClassHash", "onChainClassHash", "status"]) &&
        isFeltString(value["expectedClassHash"]) &&
        isFeltString(value["onChainClassHash"])
      );
    case "undeployed":
    case "unreachable":
      return hasOnlyKnownKeys(value, ["status"]);
    default:
      return false;
  }
};

/**
 * Checks on-chain class-hash verification responses before rendering.
 */
export const isClassHashVerificationResponse = (
  value: unknown,
): value is ClassHashVerificationResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "ok", "verification"]) &&
  value["ok"] === true &&
  isAccountId(value["accountId"]) &&
  isClassHashVerification(value["verification"]);
