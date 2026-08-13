/**
 * Pure discovery helpers for ERC20 allowances the wallet did not itself grant.
 * Decoding on-chain `Approval` events and merging the resulting external
 * allowances with the locally tracked ones is network-free so every rule is
 * unit-testable; the actual event/allowance queries live in ./allowance-scan.
 */

import { hasOnlyKnownKeys, isBaseUnitsAmount, isRecord } from "@mc-wallet/core/json";

import {
  type AllowanceRecord,
  allowanceId,
  hasValidAllowanceFields,
} from "@mc-wallet/transactions/allowance-store";

import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
  UINT128_LIMIT,
  uint256Felts,
} from "@mc-wallet/wallet-model/networks";
import { hash } from "starknet";

/**
 * A uint256 amount at or above this threshold is treated as an effectively
 * unlimited allowance: the conventional max-u128 sentinel, or any value that
 * sets the high 128-bit word, is far beyond a real spend cap. The one shared cut-off — the pre-sign verifier's
 * unlimited-approval risk flag (@mc-wallet/transactions/verify) and the
 * allowance manager's display both read it here, so a transaction flagged
 * before signing is the same one the manager later lists as unlimited. Do not
 * re-derive the `1n << 128n` literal locally — the exponent itself is
 * `UINT128_LIMIT` in @mc-wallet/wallet-model/networks, the same bound the
 * shared uint256 join holds each limb to.
 */
export const UNLIMITED_ALLOWANCE_THRESHOLD = UINT128_LIMIT - 1n;

/**
 * The Starknet event selector emitted by an ERC20 `approve`.
 */
export const APPROVAL_EVENT_KEY = hash.getSelectorFromName("Approval");

/**
 * Where a listed allowance came from: `wallet` for approvals the active account
 * submitted through this wallet (tracked locally), `multisig` for ones a
 * watched multisig granted when this account executed a proposal (tracked
 * locally under the multisig's own scope, and revokable only by proposing from
 * that multisig), and `external` for ones discovered on-chain.
 */
export type AllowanceSource = "external" | "multisig" | "wallet";

/**
 * A tracked allowance enriched with its origin for display. Extends the stored
 * record shape so wallet-granted entries carry through unchanged.
 *
 * `unconfirmedToken` marks a row whose contract the wallet cannot say is a
 * fungible token: an ERC721 `approve(to, token_id)` and an ERC20
 * `approve(spender, amount)` are the same three felts, so on a contract that is
 * neither a tracked token nor answering an `allowance(owner, spender)` read the
 * amount may be an item id rather than a spend cap. Derived per listing (never
 * stored), only `true` is representable, and the manager must neither state the
 * value as an allowance nor offer the ERC20 revoke for such a row — on an
 * ERC721, `approve(spender, 0)` approves item #0 instead of revoking.
 */
export type AllowanceView = AllowanceRecord & {
  readonly source: AllowanceSource;
  readonly unconfirmedToken?: true;
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
 * The live on-chain amount of one allowance the wallet already tracks, keyed by
 * that record's id. Produced by a direct `allowance(owner, spender)` read (see
 * ./allowance-scan), which — unlike event-driven discovery — reaches tokens the
 * user does not track and owners that are not the active account.
 */
export type AllowanceReading = {
  readonly amount: string;
  readonly id: string;
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
    "lowerBound",
    "networkId",
    "source",
    "spender",
    "token",
    "unconfirmedToken",
  ]) &&
  (value["source"] === "external" ||
    value["source"] === "multisig" ||
    value["source"] === "wallet") &&
  (value["unconfirmedToken"] === undefined || value["unconfirmedToken"] === true) &&
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
export const parseAllowanceAmount = (response: readonly string[]): string | null =>
  uint256Felts(response[0], response[1])?.toString() ?? null;

// Adopts the on-chain reading of one (token, spender) pair when it is the
// stronger statement about what the spender may take. Both readings can be
// incomplete: the local log cannot see grants made outside this wallet,
// increases applied on top of them, or entries the retention cap evicted (such
// a record is marked `lowerBound`), while the on-chain read cannot see an
// approval this wallet has broadcast but the network has not mined yet, and it
// is simply absent whenever the node fails, is offline, or is hostile. Taking
// the LARGER never understates a spender's reach — the only direction that can
// hide a drainer — and no answer at all leaves the tracked figure standing.
//
// A reading that is at least the tracked figure also RESOLVES a lower bound:
// the chain has now stated the standing allowance for that exact pair, so the
// row stops being an "at least" and becomes exact. A smaller reading leaves the
// record — and its lower-bound marking — alone.
const withOnChainAmount = (view: AllowanceView, onChain: string | undefined): AllowanceView => {
  if (!isBaseUnitsAmount(onChain) || !isBaseUnitsAmount(view.amount)) {
    return view;
  }
  if (BigInt(onChain) < BigInt(view.amount)) {
    return view;
  }
  // Rebuilt field by field rather than spread, so the resolved `lowerBound`
  // marking is dropped rather than carried over. Re-validated before adoption,
  // so a scan that answered with an out-of-range value cannot push a record
  // past the field rules the message boundary enforces.
  const candidate: AllowanceView = {
    accountId: view.accountId,
    amount: onChain,
    id: view.id,
    networkId: view.networkId,
    source: view.source,
    spender: view.spender,
    token: view.token,
  };
  return isAllowanceView(candidate) ? candidate : view;
};

// One discovered allowance as a display view for the active account, or null
// when it is already revoked (a zero amount), malformed, or fails the field
// rules the message boundary enforces.
const externalView = (
  entry: ExternalAllowance,
  accountId: string,
  networkId: AllowanceRecord["networkId"],
): AllowanceView | null => {
  if (entry.amount === "0") {
    return null;
  }
  const id = allowanceId({ accountId, networkId, ...entry });
  const token = canonicalFelt(entry.token);
  const spender = canonicalFelt(entry.spender);
  if (!id || !token || !spender) {
    return null;
  }
  const candidate: AllowanceView = {
    accountId,
    amount: entry.amount,
    id,
    networkId,
    source: "external",
    spender,
    token,
  };
  return isAllowanceView(candidate) ? candidate : null;
};

/**
 * Merges the wallet's locally tracked allowances — the active account's own,
 * plus any granted by a watched multisig this account executed for — with the
 * ones discovered on-chain, for a single network.
 *
 * Locally tracked entries take precedence as ENTRIES: an external allowance for
 * the same (token, spender) is dropped so the list never shows a duplicate, and
 * zero-amount externals (already revoked) are omitted. Their AMOUNT, however,
 * comes from the on-chain reading whenever that reading is at least as large
 * (see `withOnChainAmount`), so a grant this wallet only partly knows about — an
 * `increase_allowance` on top of an approval granted elsewhere — is never listed
 * as less than the spender can take, and a record marked as a lower bound stops
 * being one as soon as the chain answers for it. Readings taken per tracked
 * record (`readings`, which reach untracked tokens and multisig-owned scopes)
 * take precedence over amounts inferred from the event-driven external scan,
 * which can only ever speak for the active account. Externals are appended after
 * the locally tracked entries. Pure: it reads only what it is handed.
 */
export const mergeAllowanceViews = (input: {
  readonly account: { readonly id: string };
  readonly external: readonly ExternalAllowance[];
  readonly inWallet: readonly AllowanceRecord[];
  readonly multisig?: readonly AllowanceRecord[];
  readonly networkId: AllowanceRecord["networkId"];
  readonly readings?: readonly AllowanceReading[];
}): readonly AllowanceView[] => {
  const { account, external, inWallet, networkId } = input;
  const onChainAmounts = new Map<string, string>();
  // The event scan speaks only for the ACTIVE account's address, so its results
  // are keyed under that account's ids...
  for (const entry of external) {
    const id = allowanceId({ accountId: account.id, networkId, ...entry });
    if (id) {
      onChainAmounts.set(id, entry.amount);
    }
  }
  // ...while a per-record reading already carries the id of the record it was
  // taken for, whichever scope owns it, and therefore wins.
  for (const reading of input.readings ?? []) {
    onChainAmounts.set(reading.id, reading.amount);
  }
  const trackedViews: AllowanceView[] = [
    ...inWallet.map((record): AllowanceView => ({ ...record, source: "wallet" })),
    ...(input.multisig ?? []).map((record): AllowanceView => ({ ...record, source: "multisig" })),
  ].map((view) => withOnChainAmount(view, onChainAmounts.get(view.id)));
  const seen = new Set(trackedViews.map((view) => view.id));
  const externalViews: AllowanceView[] = [];
  for (const entry of external) {
    const candidate = externalView(entry, account.id, networkId);
    if (candidate && !seen.has(candidate.id)) {
      seen.add(candidate.id);
      externalViews.push(candidate);
    }
  }
  return [...trackedViews, ...externalViews];
};
