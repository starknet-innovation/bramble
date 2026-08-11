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

import { hasOnlyKnownKeys, isBaseUnitsAmount, isRecord } from "@mc-wallet/core/json";
import type { KeyValueStore } from "@mc-wallet/store/kv";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";
import { isAccountIdForNetwork } from "@mc-wallet/wallet-model/accounts";

import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";

/**
 * Browser storage key for the allowance log.
 */
export const ALLOWANCE_STORE_KEY = "mc-wallet:allowances";

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
 * multisig contract's own scope (`MultisigRecord.id`, which shares the
 * `<networkId>:<address>` shape), not from the signer that broadcast it.
 */
export type AllowanceOwner = Pick<AllowanceInput, "accountId" | "networkId">;

/**
 * One tracked allowance with a deterministic id derived from its account,
 * token, and spender.
 */
export type AllowanceRecord = AllowanceInput & { readonly id: string };

/**
 * Allowance log surface used by background message handling. `record` upserts by
 * id and treats an exact zero amount as a removal, so revoking cleans up the
 * entry; `applyDelta` upserts RELATIVE to the tracked total in one serialized
 * read-modify-write, which is the only concurrency-safe way to apply an
 * `increase_allowance` (composing `list` + `record` at a caller loses one of two
 * concurrent grants, because `list` is a concurrent read by design).
 * Retention follows `ALLOWANCE_LIMITS`: a per-account-and-network cap so one
 * account never evicts another's records, plus a total cap that keeps the
 * persisted log inside the storage boundary's bounded-JSON budget. Both writers
 * ignore an entry whose token or spender is not a felt rather than throwing, and
 * a subtraction that lands on zero without an exact base is kept as a
 * zero-valued lower bound rather than deleted — see {@link AllowanceInput}.
 */
export type AllowanceStore = {
  readonly applyDelta: (delta: AllowanceDelta) => Promise<void>;
  readonly list: () => Promise<readonly AllowanceRecord[]>;
  readonly record: (entry: AllowanceInput) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
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

// How many entries each scope may keep once the log as a whole has to fit in
// `limit`. Each round levels down every scope currently holding the most, so the
// scopes that caused the overflow pay for it and the survivors end up within one
// entry of an equal share — a scope is never emptied while another still holds a
// full quota. Levelling the whole tallest row (rather than picking one scope by
// name) is what keeps it fair: a tie broken by a fixed rule would send every
// eviction to the same unlucky account until it was empty.
const scopeBudgets = (
  counts: ReadonlyMap<string, number>,
  limit: number,
): ReadonlyMap<string, number> => {
  const budgets = new Map(counts);
  let total = [...budgets.values()].reduce((sum, count) => sum + count, 0);
  while (total > limit) {
    const tallest = Math.max(...budgets.values());
    for (const [scope, count] of budgets) {
      if (count === tallest && total > limit) {
        budgets.set(scope, count - 1);
        total -= 1;
      }
    }
  }
  return budgets;
};

// Fits the log inside the total cap while leaving one slot for the incoming
// entry, evicting the oldest records of the fullest scopes rather than the
// oldest records overall.
//
// Global age was the trap the per-scope cap only half-closed: with the log
// full, one account granting allowances all afternoon evicts another account's
// records one per write until that account reports "no allowances" while still
// holding live unlimited approvals — the exact false negative this bound exists
// to prevent, reached at four saturated scopes instead of one. Recency of WRITE
// is not evidence of liveness, so it may decide which of a scope's own records
// goes, never which scope goes hungry.
const trimToTotal = (entries: readonly AllowanceRecord[]): readonly AllowanceRecord[] => {
  if (entries.length < MAX_ENTRIES_TOTAL) {
    return entries;
  }
  const counts = new Map<string, number>();
  for (const stored of entries) {
    counts.set(allowanceScope(stored), (counts.get(allowanceScope(stored)) ?? 0) + 1);
  }
  const budgets = scopeBudgets(counts, MAX_ENTRIES_TOTAL - 1);
  const remaining = new Map(budgets);
  const kept: AllowanceRecord[] = [];
  // Newest first, so the slots a scope keeps are its most recent records and
  // the ones it gives up are its oldest.
  for (const stored of [...entries].reverse()) {
    const scope = allowanceScope(stored);
    const budget = remaining.get(scope) ?? 0;
    if (budget > 0) {
      remaining.set(scope, budget - 1);
      kept.push(stored);
    }
  }
  return kept.reverse();
};

// Upserts one allowance, trimming the writing account's own network scope before
// the whole log. A trim that was only global would let a busy account silently
// drop allowances the user can no longer see or revoke; a trim that was only
// per-scope would let enough scopes grow the log past the storage boundary's
// JSON budget, after which every write is rejected and nothing is tracked.
const entriesAfterRecord = (
  entries: readonly AllowanceRecord[],
  next: AllowanceRecord,
): readonly AllowanceRecord[] => {
  const kept = entries.filter((stored) => stored.id !== next.id);
  // A zero EXACT amount is a revocation — `approve(spender, 0)` states the
  // standing allowance outright — so the entry goes. A zero LOWER BOUND states
  // nothing at all about what remains, and dropping it would erase the only
  // record of a pair the user can still be exposed to and can still revoke.
  if (next.amount === "0" && !next.lowerBound) {
    return kept;
  }
  const retained = new Set(
    kept.filter((stored) => sameScope(stored, next)).slice(-(MAX_ENTRIES_PER_SCOPE - 1)),
  );
  const scoped = kept.filter((stored) => !sameScope(stored, next) || retained.has(stored));
  return [...trimToTotal(scoped), next];
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
  };
};
