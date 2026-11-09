/**
 * The persistent allowance log as the background composes it. Eviction ranks
 * amounts in whole tokens, so the log reads the tokens the wallet trusts on
 * every write (issue 647): untracked tokens go first, then tracked ones by
 * their decimal-normalised amount, unlimited grants last.
 *
 * Trust boundary: only `trustedTokens` — the same rule the pre-sign verifier
 * applies — may lend a token's decimals to ranking, so a likely-spam or
 * dapp-named token cannot claim few decimals to outrank real grants. Failure
 * behaviour: a preferences read that fails ranks every record as untracked;
 * the write itself never depends on it.
 */
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { KeyValueStore } from "@bramble/store/kv";
import { type AllowanceStore, createAllowanceStore } from "@bramble/transactions/allowance-store";
import { trustedTokens } from "@bramble/transactions/verify";

/**
 * Creates the allowance log over `store`, ranked by the trusted tokens in the
 * preferences `readPreferences` returns at each write.
 */
export const createRankedAllowanceStore = (
  store: KeyValueStore,
  readPreferences: () => Promise<WalletPreferences>,
): AllowanceStore =>
  createAllowanceStore({
    store,
    trackedTokens: async () => trustedTokens(await readPreferences()),
  });
