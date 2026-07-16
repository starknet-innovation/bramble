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

// A positive (non-zero) felt, matching the domain invariant: the on-chain and
// expected hashes carried by a `verified`/`mismatch` verdict are always
// non-zero felts (a zero on-chain hash is classified `undeployed`, and the
// expected hash is validated non-zero before any RPC call). Accepting `0x0`
// here — or a negative — would let a malformed payload render as a
// "Verified on-chain" result for an effectively-undeployed class, the exact
// false positive this parser exists to reject.
const isNonZeroFelt = (value: unknown): value is string => {
  const felt = asFelt(value);
  return felt !== null && felt > 0n;
};

const isClassHashVerification = (value: unknown): value is ClassHashVerification => {
  if (!isRecord(value)) {
    return false;
  }
  switch (value["status"]) {
    case "verified":
      return (
        hasOnlyKnownKeys(value, ["onChainClassHash", "status"]) &&
        isNonZeroFelt(value["onChainClassHash"])
      );
    case "mismatch":
      return (
        hasOnlyKnownKeys(value, ["expectedClassHash", "onChainClassHash", "status"]) &&
        isNonZeroFelt(value["expectedClassHash"]) &&
        isNonZeroFelt(value["onChainClassHash"])
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
