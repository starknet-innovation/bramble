/**
 * The side-panel render cache: the single in-memory snapshot the paint loop
 * reads from. It is a plain UI-side mirror of data already fetched through the
 * permissioned runtime clients — it holds no secrets and is never persisted, so
 * it is safe to reset to the locked/empty state whenever the vault is locked.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import type { SignabilityVerdict, WalletStatus } from "../../../popup/responses/responses";
import type { MultisigClient } from "../../journeys/multisig/multisig-runtime";
import { emptyStatus, type SidepanelWallet } from "../../runtime/runtime";

// The price snapshot as the runtime client returns it; the cache's price fields
// derive from this so their types cannot drift from loadPrices.
type LoadedPrices = Awaited<ReturnType<SidepanelWallet["loadPrices"]>>;

// The activity snapshot as the runtime client returns it; the cache's activity
// fields derive from this so they cannot drift from loadActivity.
type LoadedActivity = Awaited<ReturnType<SidepanelWallet["loadActivity"]>>;

type LoadedMultisigs = Exclude<Awaited<ReturnType<MultisigClient["loadMultisigs"]>>, "error">;

/**
 * Everything a paint reads. Each field mirrors the resolved result of one
 * permissioned runtime call; view-scoped fields stay in their empty state until
 * the matching view hydrates. Types are derived from the runtime clients so the
 * cache can never drift from what those clients actually return.
 */
export type RenderData = {
  allowances: Awaited<ReturnType<SidepanelWallet["loadAllowances"]>>;
  multisigs: LoadedMultisigs;
  multisigsError: boolean;
  multisigsNetworkId: string | null;
  multisigClassDeclared: boolean | "error" | null;
  multisigBalanceId: string | null;
  multisigBalances: Awaited<ReturnType<MultisigClient["loadBalances"]>>;
  balances: Awaited<ReturnType<SidepanelWallet["loadBalances"]>>;
  chart: readonly number[];
  classHashVerification: Awaited<ReturnType<SidepanelWallet["loadClassHashVerification"]>>;
  connectedSites: Awaited<ReturnType<SidepanelWallet["connectedSites"]>>;
  deployment: boolean | null;
  signability: SignabilityVerdict | null;
  pending: Awaited<ReturnType<SidepanelWallet["loadPendingApprovals"]>>;
  preferences: WalletPreferences | null;
  changes: LoadedPrices["changes"];
  prices: LoadedPrices["prices"];
  priceAsOf: LoadedPrices["asOf"];
  priceStale: LoadedPrices["stale"];
  status: WalletStatus;
  transactions: LoadedActivity["entries"];
  historyUnavailable: LoadedActivity["historyUnavailable"];
};

/**
 * Empty account-scoped activity lane used during account/network switches so
 * transactions and degraded-history state never flash under another account.
 */
const emptyActivityCache = (): Pick<RenderData, "historyUnavailable" | "transactions"> => ({
  historyUnavailable: false,
  transactions: [],
});

/**
 * Applies a freshly loaded status and clears account-scoped render data when
 * the active signer or network changed. The precise change is returned so a
 * signer handoff can retain a selected contract-account portfolio while a
 * network switch still leaves it.
 */
export const updateRenderScope = (
  cache: RenderData,
  status: WalletStatus,
): "account" | "network" | null => {
  const accountChanged = cache.status.activeAccountId !== status.activeAccountId;
  const networkChanged = cache.status.networkId !== status.networkId;
  const changed = accountChanged || networkChanged;
  Object.assign(cache, {
    status,
    ...(changed
      ? {
          ...emptyActivityCache(),
          balances: { error: "balances unavailable" },
          multisigBalanceId: null,
          multisigBalances: { error: "multisig balances unavailable" },
          deployment: null,
          signability: null,
          multisigClassDeclared: null,
          multisigsError: false,
          ...(networkChanged ? { multisigsNetworkId: null } : {}),
        }
      : {}),
  });
  return networkChanged ? "network" : accountChanged ? "account" : null;
};

/**
 * A fresh render cache in the locked/empty state. `balances` carries the
 * "wallet locked" error marker so the home screen renders the locked shell
 * until real balances hydrate; every list starts empty and every optional
 * value null. Used to prime the cache at boot and to reset it on lock.
 */
export const emptyRenderCache = (): RenderData => ({
  allowances: [],
  multisigs: { intents: [], multisigs: [] },
  multisigsError: false,
  multisigsNetworkId: null,
  multisigClassDeclared: null,
  multisigBalanceId: null,
  multisigBalances: { error: "multisig balances unavailable" },
  balances: { error: "wallet locked" },
  chart: [],
  classHashVerification: null,
  connectedSites: [],
  deployment: null,
  signability: null,
  ...emptyActivityCache(),
  pending: [],
  changes: {},
  preferences: null,
  prices: {},
  priceAsOf: null,
  priceStale: false,
  status: emptyStatus(),
});

/**
 * The on-chain class-hash verdict to display for the given active account: the
 * cached verification only when it was resolved for that same account, else
 * null (the still-verifying state). Gating on the account id at read time is
 * what guarantees a verdict is never shown under a different account's class
 * hash — neither the stale value left behind across an account switch (the
 * cache is not reset synchronously) nor a slow verification that resolved for
 * an account the user has already left. Fail-safe: anything but an exact
 * account-id match reads as pending, never as another account's "verified".
 */
export const verificationForAccount = (
  cached: RenderData["classHashVerification"],
  activeAccountId: string | null,
): ClassHashVerification | null =>
  cached && cached.accountId === activeAccountId ? cached.verification : null;
