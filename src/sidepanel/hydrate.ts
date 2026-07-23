/**
 * View-scoped hydration for the side panel. After the instant paint from cache,
 * this streams in the fresh network data each screen needs (balances, prices,
 * activity, class-hash verification, allowances, NFTs, multisig state, charts)
 * in parallel, then repaints once when the batch resolves. Kept out of
 * `./index.ts` so the app shell stays within the file-length standard.
 */

import type { WalletStatus } from "../popup/responses";
import type { DeploymentCache } from "./deployment-cache";
import type { MultisigClient } from "./multisig-runtime";
import type { RenderData } from "./render-cache";
import type { SidepanelWallet } from "./runtime";
import type { WalletView } from "./views";

/**
 * Inputs `hydrateView` needs: the current status/view, the shared render cache,
 * the wallet/multisig/deployment clients, and the repaint callback.
 */
export type HydrateDeps = {
  readonly status: WalletStatus;
  readonly activeView: WalletView;
  readonly selectedTokenId: string | null;
  readonly cache: RenderData;
  readonly wallet: SidepanelWallet;
  readonly multisig: MultisigClient;
  readonly deployment: DeploymentCache;
  readonly paint: () => void;
};

/**
 * Loads the view-scoped network data in parallel and repaints once it lands.
 * Each loader is best-effort: a rejected fetch leaves the cached value intact
 * rather than blanking the screen.
 */
export const hydrateView = async (deps: HydrateDeps): Promise<void> => {
  const { status, activeView, selectedTokenId, cache, wallet, multisig, deployment, paint } = deps;
  const jobs: Promise<unknown>[] = [];
  const fill = <T>(load: Promise<T>, assign: (value: T) => void): void => {
    jobs.push(load.then(assign).catch(() => undefined));
  };
  if (
    activeView === "home" ||
    activeView === "swap" ||
    activeView === "tokens" ||
    activeView === "token-detail"
  ) {
    fill(wallet.loadBalances(), (value) => {
      cache.balances = value;
    });
    fill(wallet.loadPrices(), (value) => {
      cache.prices = value.prices;
      cache.changes = value.changes;
      cache.priceAsOf = value.asOf;
      cache.priceStale = value.stale;
    });
  }
  if (activeView === "home") {
    fill(deployment.load(status, activeView), (value) => {
      cache.deployment = value;
    });
  }
  if (activeView === "activity" || activeView === "home") {
    fill(wallet.loadActivity(), (value) => {
      cache.transactions = value.entries;
      cache.historyUnavailable = value.historyUnavailable;
    });
  }
  if (activeView === "account") {
    fill(wallet.loadClassHashVerification(), (value) => {
      cache.classHashVerification = value;
    });
  }
  if (activeView === "connected-sites") {
    fill(wallet.connectedSites(), (value) => {
      cache.connectedSites = value;
    });
  }
  if (activeView === "allowances") {
    fill(wallet.loadAllowances(), (value) => {
      cache.allowances = value;
    });
  }
  if (activeView === "nfts" || activeView === "nft-detail") {
    fill(wallet.discoverNfts(), (value) => {
      cache.discoveredNfts = value;
    });
  }
  if (
    activeView === "multisigs" ||
    activeView === "multisig-detail" ||
    activeView === "multisig-propose" ||
    activeView === "multisig-deploy"
  ) {
    fill(multisig.loadMultisigs(), (value) => {
      cache.multisigs = value;
    });
  }
  if (activeView === "multisig-deploy") {
    fill(multisig.loadClassStatus(), (value) => {
      cache.multisigClassDeclared = value;
    });
  }
  if (activeView === "token-detail") {
    const selected = cache.preferences?.tokens.find((token) => token.id === selectedTokenId);
    if (selected) {
      fill(wallet.loadTokenChart(selected.address), (value) => {
        cache.chart = value;
      });
    }
  }
  if (jobs.length > 0) {
    await Promise.all(jobs);
    paint();
  }
};
