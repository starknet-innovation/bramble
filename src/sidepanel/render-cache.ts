/**
 * The side-panel render cache: the single in-memory snapshot the paint loop
 * reads from. It is a plain UI-side mirror of data already fetched through the
 * permissioned runtime clients — it holds no secrets and is never persisted, so
 * it is safe to reset to the locked/empty state whenever the vault is locked.
 */

import type { WalletStatus } from "../popup/responses";
import type { WalletPreferences } from "../storage/preferences-store";
import type { MultisigClient } from "./multisig-runtime";
import { emptyStatus, type SidepanelWallet } from "./runtime";

// The price snapshot as the runtime client returns it; the cache's price fields
// derive from this so their types cannot drift from loadPrices.
type LoadedPrices = Awaited<ReturnType<SidepanelWallet["loadPrices"]>>;

/**
 * Everything a paint reads. Each field mirrors the resolved result of one
 * permissioned runtime call; view-scoped fields stay in their empty state until
 * the matching view hydrates. Types are derived from the runtime clients so the
 * cache can never drift from what those clients actually return.
 */
export type RenderData = {
  allowances: Awaited<ReturnType<SidepanelWallet["loadAllowances"]>>;
  multisigs: Awaited<ReturnType<MultisigClient["loadMultisigs"]>>;
  multisigClassDeclared: boolean | "error" | null;
  balances: Awaited<ReturnType<SidepanelWallet["loadBalances"]>>;
  chart: readonly number[];
  connectedSites: Awaited<ReturnType<SidepanelWallet["connectedSites"]>>;
  deployment: boolean | null;
  discoveredNfts: Awaited<ReturnType<SidepanelWallet["discoverNfts"]>>;
  pending: Awaited<ReturnType<SidepanelWallet["loadPendingApprovals"]>>;
  preferences: WalletPreferences | null;
  changes: LoadedPrices["changes"];
  prices: LoadedPrices["prices"];
  priceAsOf: LoadedPrices["asOf"];
  priceStale: LoadedPrices["stale"];
  status: WalletStatus;
  transactions: Awaited<ReturnType<SidepanelWallet["loadActivity"]>>;
};

/**
 * A fresh render cache in the locked/empty state. `balances` carries the
 * "wallet locked" error marker so the home screen renders the locked shell
 * until real balances hydrate; every list starts empty and every optional
 * value null. Used to prime the cache at boot and to reset it on lock.
 */
export const emptyRenderCache = (): RenderData => ({
  allowances: [],
  multisigs: { multisigs: [], proposals: [] },
  multisigClassDeclared: null,
  balances: { error: "wallet locked" },
  chart: [],
  connectedSites: [],
  deployment: null,
  discoveredNfts: [],
  pending: [],
  changes: {},
  preferences: null,
  prices: {},
  priceAsOf: null,
  priceStale: false,
  status: emptyStatus(),
  transactions: [],
});
