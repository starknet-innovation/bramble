/**
 * Pure discovery helpers for ERC20 allowances the wallet did not itself grant.
 * Decoding on-chain `Approval` events and merging the resulting external
 * allowances with the locally tracked ones is network-free so every rule is
 * unit-testable; the actual event/allowance queries live in ./allowance-scan.
 */
import { hash } from "starknet";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import {
  type AllowanceRecord,
  allowanceId,
  hasValidAllowanceFields,
} from "../storage/allowance-store";
import { canonicalFelt, isNonZeroStarkFieldElement, sameFelt } from "./networks";

const UINT_128_SHIFT = 128n;

/**
 * A uint256 amount at or above this threshold is treated as an effectively
 * unlimited allowance for display. Matches the side panel's own cut-off: any
 * value that sets the high 128-bit word is far beyond a real spend cap.
 */
export const UNLIMITED_ALLOWANCE_THRESHOLD = 1n << 128n;

/**
 * The Starknet event selector emitted by an ERC20 `approve`.
 */
export const APPROVAL_EVENT_KEY = hash.getSelectorFromName("Approval");

/**
 * Where a listed allowance came from: `wallet` for approvals this wallet
 * submitted (tracked locally) and `external` for ones discovered on-chain.
 */
export type AllowanceSource = "external" | "wallet";

/**
 * A tracked allowance enriched with its origin for display. Extends the stored
 * record shape so wallet-granted entries carry through unchanged.
 */
export type AllowanceView = AllowanceRecord & {
  readonly source: AllowanceSource;
};

/**
 * One outstanding allowance read from chain: the current on-chain amount for a
 * (token, spender) pair, independent of whether this wallet granted it.
 */
export type ExternalAllowance = {
  readonly amount: string;
  readonly spender: string;
  readonly token: string;
};

/**
 * The owner and spender decoded from an ERC20 `Approval` event.
 */
export type DecodedApprovalEvent = {
  readonly owner: string;
  readonly spender: string;
};

/**
 * Checks whether a decimal allowance amount should display as unlimited.
 * Non-numeric input is treated as not unlimited so a malformed amount never
 * silently reads as an infinite approval.
 */
export const isUnlimitedAllowance = (amount: string): boolean => {
  try {
    return BigInt(amount) >= UNLIMITED_ALLOWANCE_THRESHOLD;
  } catch {
    return false;
  }
};

/**
 * Validates an allowance view (a stored record plus its `source`) before it is
 * rendered or accepted across the message boundary.
 */
export const isAllowanceView = (value: unknown): value is AllowanceView =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "amount",
    "id",
    "networkId",
    "source",
    "spender",
    "token",
  ]) &&
  (value["source"] === "external" || value["source"] === "wallet") &&
  hasValidAllowanceFields(value);

/**
 * Decodes an ERC20 `Approval` event into its owner and spender, or null when
 * the event is not a well-formed approval. Handles both the Cairo 1 layout
 * (owner and spender are indexed keys) and the legacy layout (they sit in the
 * data payload), so approvals from either token generation are discoverable.
 */
export const decodeApprovalEvent = (event: {
  readonly data: readonly string[];
  readonly keys: readonly string[];
}): DecodedApprovalEvent | null => {
  if (!sameFelt(event.keys[0], APPROVAL_EVENT_KEY)) {
    return null;
  }
  const [rawOwner, rawSpender] =
    event.keys.length >= 3 ? [event.keys[1], event.keys[2]] : [event.data[0], event.data[1]];
  const owner = typeof rawOwner === "string" ? canonicalFelt(rawOwner) : null;
  const spender = typeof rawSpender === "string" ? canonicalFelt(rawSpender) : null;
  if (
    !owner ||
    !spender ||
    !isNonZeroStarkFieldElement(owner) ||
    !isNonZeroStarkFieldElement(spender)
  ) {
    return null;
  }
  return { owner, spender };
};

/**
 * Parses an ERC20 uint256 `allowance` response `[low, high]` into a decimal
 * string, or null when the response is not a valid uint256 pair.
 */
export const parseAllowanceAmount = (response: readonly string[]): string | null => {
  const low = response[0];
  const high = response[1];
  if (typeof low !== "string" || typeof high !== "string") {
    return null;
  }
  try {
    return (BigInt(low) + (BigInt(high) << UINT_128_SHIFT)).toString();
  } catch {
    return null;
  }
};

/**
 * Merges the wallet's locally tracked allowances with externally discovered
 * ones for a single account and network. Wallet-granted entries take
 * precedence: an external allowance for the same (token, spender) is dropped so
 * the list never shows a duplicate, and zero-amount externals (already revoked)
 * are omitted. Externals are appended after the wallet entries.
 */
export const mergeAllowanceViews = (
  inWallet: readonly AllowanceRecord[],
  external: readonly ExternalAllowance[],
  account: { readonly id: string },
  networkId: AllowanceRecord["networkId"],
): readonly AllowanceView[] => {
  const walletViews: AllowanceView[] = inWallet.map((record) => ({ ...record, source: "wallet" }));
  const seen = new Set(walletViews.map((view) => view.id));
  const externalViews: AllowanceView[] = [];
  for (const entry of external) {
    if (entry.amount === "0") {
      continue;
    }
    const id = allowanceId({
      accountId: account.id,
      amount: entry.amount,
      networkId,
      spender: entry.spender,
      token: entry.token,
    });
    const token = canonicalFelt(entry.token);
    const spender = canonicalFelt(entry.spender);
    if (!id || !token || !spender || seen.has(id)) {
      continue;
    }
    const candidate: AllowanceView = {
      accountId: account.id,
      amount: entry.amount,
      id,
      networkId,
      source: "external",
      spender,
      token,
    };
    if (isAllowanceView(candidate)) {
      seen.add(id);
      externalViews.push(candidate);
    }
  }
  return [...walletViews, ...externalViews];
};
