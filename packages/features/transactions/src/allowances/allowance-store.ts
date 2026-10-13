/**
 * Local record of ERC20 spending allowances this wallet granted through
 * `approve`, `increase_allowance`, and `decrease_allowance` calls. Plain data
 * kept outside the encrypted vault so the allowance manager can list and revoke
 * them. This store tracks what this wallet submitted; allowances granted
 * elsewhere are discovered on-chain by ../starknet/allowance-scan.
 *
 * What an entry's `amount` IS: the second argument of the approve-shaped call
 * this wallet submitted, in the token's base units. It is a spendable ERC20
 * allowance only for a contract the wallet can classify as fungible — an ERC721
 * `approve(to, item_id)` has the same three felts, and the writer drops only the
 * collections the account WATCHES (../starknet/allowances.ts). A consumer must
 * therefore classify before presenting a figure as an allowance or revoking one;
 * ../background/allowance-ops.ts is where that is decided for the manager.
 *
 * ERC20's relative changes are applied HERE, inside `applyDelta`, rather than
 * by a caller composing `list` + `record`: `list` is deliberately a concurrent
 * read, so a read-modify-write assembled outside this module escapes the
 * mutation queue and two concurrent increases lose one of the two grants.
 */

import { hasOnlyKnownKeys, isBaseUnitsAmount, isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import { keepLargest, trimToTotal } from "./allowance-retention";

/**
 * Browser storage key for the allowance log.
 */
export const ALLOWANCE_STORE_KEY = "bramble:allowances";

/**
 * Retention bounds for the allowance log.
 *
 * `entriesPerScope` is applied per account and network, so approvals on one
 * account never evict another account's records out from under the allowance
 * manager. `entriesTotal` bounds the whole persisted array, because every write
 * goes through `assertJsonValue` in `kv.ts` and a value over that bounded-JSON
 * budget is rejected — the caller in `allowance-ops` swallows the rejection, so
 * an unbounded log would silently stop tracking newly granted allowances. A log
 * of maximum-size records saturates the budget at 300 entries; both bounds are
 * set below that with margin and pinned by `allowance-store-budget.test.ts`.
 * Consume these instead of re-deriving either literal.
 *
 * The total bound is spent fairly rather than by global age: see
 * {@link allowanceScope} and `trimToTotal`. Age alone would let one busy scope
 * empty an idle one entry by entry, which is the same false "no allowances"
 * report the per-scope bound exists to prevent — just at a higher threshold.
 */
export const ALLOWANCE_LIMITS = {
  /** Maximum retained allowances for one account on one network. */
  entriesPerScope: 50,
  /** Maximum retained allowances across every account and network. */
  entriesTotal: 200,
} as const;

const MAX_ENTRIES_PER_SCOPE = ALLOWANCE_LIMITS.entriesPerScope;
const MAX_ENTRIES_TOTAL = ALLOWANCE_LIMITS.entriesTotal;
const MAX_AMOUNT_DIGITS = 78;

// An ERC20 allowance is a uint256, so neither a stored total nor the sum of an
// increase applied to it can exceed this. 78 digits — exactly
// MAX_AMOUNT_DIGITS, so a saturated total still validates as a stored amount.
const UINT_256_MAX = (1n << 256n) - 1n;

/**
 * Fields describing one allowance the user granted through this wallet.
 *
 * `lowerBound` marks an amount the wallet knows is AT LEAST this large but
 * cannot state exactly: an `increase_allowance` applied on top of a base this
 * wallet never saw (granted on the dapp's own site, or evicted by the retention
 * cap) is the increment plus an unknown base. Absent means the amount is the
 * exact standing allowance. Only `true` is representable, so "exact" has one
 * spelling; the manager renders a lower bound as "at least N" rather than
 * claiming a spender's reach is smaller than it is.
 *
 * A lower bound of ZERO is therefore the weakest honest statement the log can
 * make — "this pair is approved for an amount this wallet cannot bound" — and
 * is deliberately NOT a removal: a decrease applied to an unseen base leaves an
 * allowance the user must still be able to see and revoke.
 */
export type AllowanceInput = {
  readonly accountId: string;
  readonly amount: string;
  readonly lowerBound?: true;
  readonly networkId: StarknetNetworkId;
  readonly spender: string;
  readonly token: string;
};

/**
 * A relative allowance change: ERC20's `increase_allowance` adds to the standing
 * allowance and `decrease_allowance` subtracts from it, so neither can be stored
 * without the current total. Applied by {@link AllowanceStore.applyDelta}.
 */
export type AllowanceDelta = {
  readonly direction: "add" | "subtract";
  readonly input: AllowanceInput;
};

/**
 * The account an allowance belongs to: the scope every id, retention bound, and
 * manager query is keyed by. Named separately from `AllowanceInput` because the
 * owner is not always a vault account — a multisig execution grants from the
 * multisig contract's own scope (`ArgentMultisigRecord.id`, which shares the
 * `<networkId>:<address>` shape), not from the signer that broadcast it.
 */
export type AllowanceOwner = Pick<AllowanceInput, "accountId" | "networkId">;

/**
 * One tracked allowance with a deterministic id derived from its account,
 * token, and spender.
 *
 * `revoking` marks a grant whose revocation (an `approve(spender, 0)`, or a
 * decrease to zero from an exact base) this wallet has submitted but the chain
 * has not yet confirmed. The record keeps the grant's last known amount, which
 * is still the spender's reach until the revoke executes and stays its reach
 * if the revoke reverts (Sherlock 192). Only `true` is representable.
 */
export type AllowanceRecord = AllowanceInput & {
  readonly id: string;
  readonly revoking?: true;
};

/**
 * Allowance log surface used by background message handling. `record` upserts by
 * id and keeps a grant an exact zero would revoke, marked `revoking`, because
 * a revoke is recorded when submitted and may still revert; `settleRevocations`
 * drops it once the chain reads the pair as zero. `applyDelta` upserts RELATIVE to the tracked total in one serialized
 * read-modify-write, which is the only concurrency-safe way to apply an
 * `increase_allowance` (composing `list` + `record` at a caller loses one of two
 * concurrent grants, because `list` is a concurrent read by design).
 * Retention follows `ALLOWANCE_LIMITS`: a per-account-and-network cap so one
 * account never evicts another's records, plus a total cap that keeps the
 * persisted log inside the storage boundary's bounded-JSON budget; at either
 * cap the smallest allowances go first. Both writers
 * ignore an entry whose token or spender is not a felt rather than throwing, and
 * a subtraction that lands on zero without an exact base is kept as a
 * zero-valued lower bound rather than deleted — see {@link AllowanceInput}.
 */
export type AllowanceStore = {
  readonly applyDelta: (delta: AllowanceDelta) => Promise<void>;
  readonly list: () => Promise<readonly AllowanceRecord[]>;
  readonly record: (entry: AllowanceInput) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  /**
   * Drops pending revokes and zero lower bounds that a live chain reading
   * states are zero. Any other reading, and any other record, is left alone.
   * Readings are untrusted; only an exact "0" acts.
   */
  readonly settleRevocations: (
    readings: readonly { readonly amount: string; readonly id: string }[],
  ) => Promise<void>;
};

const isAmount = (value: unknown): value is string =>
  isBaseUnitsAmount(value) && value.length <= MAX_AMOUNT_DIGITS;

/**
 * The retention and identity scope of one allowance: an account on a network.
 *
 * The two are one string because they are one fact. Every owner id this store
 * accepts — a vault account or a watched multisig — is spelled
 * `<networkId>:<address>`, and {@link hasValidAllowanceFields} refuses a record
 * whose `networkId` field disagrees with that prefix, so the same address on
 * mainnet and on Sepolia can never share a scope. The `networkId` term is
 * therefore redundant by construction and kept anyway: it makes the network
 * part of the scope a stated property of this module rather than a convention
 * inherited from how account ids happen to be spelled today.
 */
export const allowanceScope = (owner: AllowanceOwner): string =>
  `${owner.networkId}|${owner.accountId}`;

/**
 * Builds the deterministic id for an allowance from its account, token, and
 * spender. Returns null when the token or spender is not a felt.
 *
 * The account id carries the network (`<networkId>:<address>`), so the id is
 * scoped per account AND network without a separate segment — see
 * {@link allowanceScope} for why that is a guarantee and not a coincidence.
 */
export const allowanceId = (entry: AllowanceInput): string | null => {
  const token = canonicalFelt(entry.token);
  const spender = canonicalFelt(entry.spender);
  return token && spender ? `${entry.accountId}:${token}:${spender}` : null;
};

/**
 * Checks the allowance fields common to a stored record and a display view:
 * account, amount, network, spender, token, and the deterministic id derived
 * from them. Split out so the enriched allowance view can reuse the exact same
 * field validation without re-deriving it.
 */
export const hasValidAllowanceFields = (value: Record<string, unknown>): boolean =>
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  isAmount(value["amount"]) &&
  (value["lowerBound"] === undefined || value["lowerBound"] === true) &&
  (value["revoking"] === undefined || value["revoking"] === true) &&
  typeof value["id"] === "string" &&
  typeof value["spender"] === "string" &&
  isNonZeroStarkFieldElement(value["spender"]) &&
  typeof value["token"] === "string" &&
  isNonZeroStarkFieldElement(value["token"]) &&
  value["id"] === `${value["accountId"]}:${value["token"]}:${value["spender"]}`;

/**
 * Checks a stored allowance record before trusting it.
 */
export const isAllowanceRecord = (value: unknown): value is AllowanceRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "amount",
    "id",
    "lowerBound",
    "networkId",
    "revoking",
    "spender",
    "token",
  ]) &&
  hasValidAllowanceFields(value);

/**
 * Recovers the token and spender an allowance id targets, scoped to a specific
 * account. Returns null unless the id is exactly `<accountId>:<token>:<spender>`
 * with both a non-zero token and spender felt — so an id belonging to another
 * account, or a malformed one, is rejected. Lets a revoke resolve its target
 * from the id alone, covering externally discovered allowances that were never
 * written to the local store.
 */
export const allowanceTarget = (
  id: string,
  accountId: string,
): { readonly spender: string; readonly token: string } | null => {
  const prefix = `${accountId}:`;
  if (!id.startsWith(prefix)) {
    return null;
  }
  const parts = id.slice(prefix.length).split(":");
  if (parts.length !== 2) {
    return null;
  }
  const token = canonicalFelt(parts[0] ?? "");
  const spender = canonicalFelt(parts[1] ?? "");
  if (
    !token ||
    !spender ||
    !isNonZeroStarkFieldElement(token) ||
    !isNonZeroStarkFieldElement(spender)
  ) {
    return null;
  }
  return { spender, token };
};

const toRecord = (entry: AllowanceInput): AllowanceRecord | null => {
  const token = canonicalFelt(entry.token);
  const spender = canonicalFelt(entry.spender);
  const id = allowanceId(entry);
  if (!token || !spender || !id) {
    return null;
  }
  const candidate: AllowanceRecord = {
    accountId: entry.accountId,
    amount: entry.amount,
    id,
    // Written only when set, so an exact amount has exactly one stored shape
    // and an older log without the field still validates unchanged.
    ...(entry.lowerBound ? { lowerBound: true as const } : {}),
    networkId: entry.networkId,
    spender,
    token,
  };
  return isAllowanceRecord(candidate) ? candidate : null;
};

const readEntries = async (store: KeyValueStore): Promise<readonly AllowanceRecord[]> => {
  const stored = await store.get(ALLOWANCE_STORE_KEY);
  return Array.isArray(stored) ? stored.filter(isAllowanceRecord) : [];
};

const sameScope = (stored: AllowanceRecord, next: AllowanceRecord): boolean =>
  allowanceScope(stored) === allowanceScope(next);

// Upserts one allowance, trimming the writing account's own network scope before
// the whole log. A trim that was only global would let a busy account silently
// drop allowances the user can no longer see or revoke; a trim that was only
// per-scope would let enough scopes grow the log past the storage boundary's
// JSON budget, after which every write is rejected and nothing is tracked. Both
// trims drop the smallest allowances first (./allowance-retention), and the
// incoming entry competes like any other: an approval smaller than every one a
// full scope already holds is the one not kept.
//
// An exact zero does not remove the pair (Sherlock 192). Every writer records a
// call once it is submitted, not once it executes, and a revoke that then
// reverts or is rejected leaves the earlier approval standing; deleting the
// record would hide a live grant the user just tried to revoke. The grant is
// kept at its last known amount and marked `revoking` until a chain reading
// of zero confirms the revoke (see `settleRevocations`). Keeping the amount
// also keeps its rank: a pending revoke of an unlimited grant is not the first
// record a full scope evicts. An exact zero for a pair the log never held
// writes nothing: there is no grant here to keep visible.
const recordedEntry = (
  entries: readonly AllowanceRecord[],
  next: AllowanceRecord,
): AllowanceRecord | null => {
  if (next.amount !== "0" || next.lowerBound) {
    return next;
  }
  const tracked = entries.find((stored) => stored.id === next.id);
  return tracked ? { ...tracked, revoking: true as const } : null;
};

const entriesAfterRecord = (
  entries: readonly AllowanceRecord[],
  next: AllowanceRecord,
): readonly AllowanceRecord[] => {
  const recorded = recordedEntry(entries, next);
  if (!recorded) {
    return entries;
  }
  const withNext = [...entries.filter((stored) => stored.id !== next.id), recorded];
  const scopeKept = new Set(
    keepLargest(
      withNext.filter((stored) => sameScope(stored, recorded)),
      MAX_ENTRIES_PER_SCOPE,
    ),
  );
  return trimToTotal(
    withNext.filter((stored) => !sameScope(stored, recorded) || scopeKept.has(stored)),
    MAX_ENTRIES_TOTAL,
    allowanceScope,
  );
};

// Drops the records a chain reading of zero confirms are gone: a pending
// revoke, and a zero lower bound left by a decrease. Nothing else is touched,
// and no other reading rewrites a record. A non-zero reading cannot tell a
// revoke the network has not mined yet from one that reverted, and a record
// holding a figure may be ahead of the chain (a grant not mined yet), so the
// display takes the larger of the two instead (../allowance-discovery's
// `withOnChainAmount`).
const entriesAfterSettle = (
  entries: readonly AllowanceRecord[],
  readings: readonly { readonly amount: string; readonly id: string }[],
): readonly AllowanceRecord[] | null => {
  const zeroed = new Set(
    readings.filter((reading) => reading.amount === "0").map((reading) => reading.id),
  );
  const settled = entries.filter(
    (stored) =>
      !zeroed.has(stored.id) ||
      !(stored.revoking === true || (stored.amount === "0" && stored.lowerBound === true)),
  );
  return settled.length === entries.length ? null : settled;
};

// Applies one relative change to what the log already tracks for the same
// (owner, token, spender). Stored amounts are validated decimal digits so the
// arithmetic is exact; the sum saturates at the uint256 ceiling the token itself
// enforces and the difference floors at zero (the token reverts a decrease
// below zero). Nothing here is a guess:
//   - an ADD with no tracked base is the increment plus an unknown base, so it
//     is stored as a lower bound; writing it as an absolute amount is what once
//     made a one-wei top-up of an unlimited grant display as "1";
//   - a SUBTRACT whose floor lands on zero over a base that is itself only a
//     lower bound (or absent) is written as a ZERO lower bound, not as an exact
//     zero and not as nothing: the unseen base may still stand, and both
//     alternatives erase a live allowance from the manager. `entriesAfterRecord`
//     keeps that entry, and one `allowance(owner, spender)` reading later turns
//     it back into an exact figure.
// A lower bound stays one through further arithmetic: base + d and base - d are
// still bounds when base is.
const appliedDeltaInput = (
  tracked: AllowanceRecord | undefined,
  { direction, input }: AllowanceDelta,
): AllowanceInput | null => {
  if (!isAmount(input.amount)) {
    return null;
  }
  const base = tracked ? BigInt(tracked.amount) : 0n;
  const delta = BigInt(input.amount);
  const moved = direction === "add" ? base + delta : base - delta;
  const bounded = moved > UINT_256_MAX ? UINT_256_MAX : moved > 0n ? moved : 0n;
  const lowerBound = tracked ? tracked.lowerBound === true : true;
  return {
    accountId: input.accountId,
    amount: bounded.toString(),
    ...(lowerBound ? { lowerBound: true as const } : {}),
    networkId: input.networkId,
    spender: input.spender,
    token: input.token,
  };
};

// The whole read-modify-write as one pure function of the stored entries, so
// both store implementations apply identical ERC20 semantics and the persistent
// one can run it inside a single serialized mutation. Null means "write
// nothing".
const entriesAfterDelta = (
  entries: readonly AllowanceRecord[],
  delta: AllowanceDelta,
): readonly AllowanceRecord[] | null => {
  const id = allowanceId(delta.input);
  const tracked = id === null ? undefined : entries.find((stored) => stored.id === id);
  const applied = appliedDeltaInput(tracked, delta);
  const next = applied ? toRecord(applied) : null;
  return next ? entriesAfterRecord(entries, next) : null;
};

/**
 * Creates the persistent allowance log.
 */
export const createAllowanceStore = ({
  store,
}: {
  readonly store: KeyValueStore;
}): AllowanceStore =>
  serializeStoreMutations<AllowanceStore>(
    {
      async applyDelta(delta) {
        const entries = entriesAfterDelta(await readEntries(store), delta);
        if (entries) {
          await store.set(ALLOWANCE_STORE_KEY, [...entries]);
        }
      },
      async list() {
        return [...(await readEntries(store))].reverse();
      },
      async record(entry) {
        const next = toRecord(entry);
        if (!next) {
          return;
        }
        const entries = entriesAfterRecord(await readEntries(store), next);
        await store.set(ALLOWANCE_STORE_KEY, [...entries]);
      },
      async remove(id) {
        const kept = (await readEntries(store)).filter((stored) => stored.id !== id);
        await store.set(ALLOWANCE_STORE_KEY, [...kept]);
      },
      async settleRevocations(readings) {
        const settled = entriesAfterSettle(await readEntries(store), readings);
        if (settled) {
          await store.set(ALLOWANCE_STORE_KEY, [...settled]);
        }
      },
    },
    ["list"],
  );

/**
 * In-memory allowance log used as the test and fallback default.
 */
export const memoryAllowanceStore = (): AllowanceStore => {
  let entries: AllowanceRecord[] = [];
  return {
    async applyDelta(delta) {
      const next = entriesAfterDelta(entries, delta);
      if (next) {
        entries = [...next];
      }
    },
    async list() {
      return [...entries].reverse();
    },
    async record(entry) {
      const next = toRecord(entry);
      if (!next) {
        return;
      }
      entries = [...entriesAfterRecord(entries, next)];
    },
    async remove(id) {
      entries = entries.filter((stored) => stored.id !== id);
    },
    async settleRevocations(readings) {
      entries = [...(entriesAfterSettle(entries, readings) ?? entries)];
    },
  };
};
