/**
 * Local record of ERC20 spending allowances this wallet granted through
 * `approve` calls. Plain data kept outside the encrypted vault so the allowance
 * manager can list and revoke them. This store only tracks approvals submitted
 * through this wallet; on-chain enumeration of externally granted allowances is
 * a documented follow-up.
 */

import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";
import type { KeyValueStore } from "./kv";
import { isAccountId } from "./vault-schema";

/**
 * Browser storage key for the allowance log.
 */
export const ALLOWANCE_STORE_KEY = "mc-wallet:allowances";

const MAX_ENTRIES = 200;
const MAX_AMOUNT_DIGITS = 78;

/**
 * Fields describing one allowance the user granted through this wallet.
 */
export type AllowanceInput = {
  readonly accountId: string;
  readonly amount: string;
  readonly networkId: StarknetNetworkId;
  readonly spender: string;
  readonly token: string;
};

/**
 * One tracked allowance with a deterministic id derived from its account,
 * token, and spender.
 */
export type AllowanceRecord = AllowanceInput & { readonly id: string };

/**
 * Allowance log surface used by background message handling. `record` upserts by
 * id and treats a zero amount as a removal, so revoking cleans up the entry.
 */
export type AllowanceStore = {
  readonly list: () => Promise<readonly AllowanceRecord[]>;
  readonly record: (entry: AllowanceInput) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
};

const isAmount = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_AMOUNT_DIGITS &&
  /^(?:0|[1-9][0-9]*)$/.test(value);

/**
 * Builds the deterministic id for an allowance from its account, token, and
 * spender. Returns null when the token or spender is not a felt.
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
  isAccountId(value["accountId"]) &&
  isAmount(value["amount"]) &&
  typeof value["id"] === "string" &&
  isStarknetNetworkId(value["networkId"]) &&
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
  hasOnlyKnownKeys(value, ["accountId", "amount", "id", "networkId", "spender", "token"]) &&
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

/**
 * Creates the persistent allowance log.
 */
export const createAllowanceStore = ({
  store,
}: {
  readonly store: KeyValueStore;
}): AllowanceStore => ({
  async list() {
    return [...(await readEntries(store))].reverse();
  },
  async record(entry) {
    const next = toRecord(entry);
    if (!next) {
      return;
    }
    const kept = (await readEntries(store)).filter((stored) => stored.id !== next.id);
    const entries = next.amount === "0" ? kept : [...kept.slice(-(MAX_ENTRIES - 1)), next];
    await store.set(ALLOWANCE_STORE_KEY, [...entries]);
  },
  async remove(id) {
    const kept = (await readEntries(store)).filter((stored) => stored.id !== id);
    await store.set(ALLOWANCE_STORE_KEY, [...kept]);
  },
});

/**
 * In-memory allowance log used as the test and fallback default.
 */
export const memoryAllowanceStore = (): AllowanceStore => {
  let entries: AllowanceRecord[] = [];
  return {
    async list() {
      return [...entries].reverse();
    },
    async record(entry) {
      const next = toRecord(entry);
      if (!next) {
        return;
      }
      entries = entries.filter((stored) => stored.id !== next.id);
      if (next.amount !== "0") {
        entries.push(next);
      }
    },
    async remove(id) {
      entries = entries.filter((stored) => stored.id !== id);
    },
  };
};
