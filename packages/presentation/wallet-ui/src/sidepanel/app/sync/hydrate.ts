/**
 * View-scoped hydration for the side panel. After the instant paint from cache,
 * this streams in the fresh network data each screen needs (balances, prices,
 * activity, class-hash verification, allowances, NFTs, multisig state, charts)
 * in parallel, then repaints once when the batch resolves. Kept out of
 * `./index.ts` so the app shell stays within the file-length standard.
 */

import type { WalletStatus } from "../../../popup/responses/responses";
import type { MultisigClient } from "../../journeys/multisig/multisig-runtime";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { RenderData } from "../rendering/render-cache";
import type { WalletView } from "../screens/views";
import type { DeploymentCache } from "./deployment-cache";

/**
 * Inputs `hydrateView` needs: the current status/view, the shared render cache,
 * the wallet/multisig/deployment clients, and the repaint callback.
 */
export type HydrateDeps = {
  readonly status: WalletStatus;
  readonly activeView: WalletView;
  readonly selectedMultisigId: string | null;
  readonly selectedTokenId: string | null;
  readonly cache: RenderData;
  readonly isCurrent?: () => boolean;
  readonly wallet: SidepanelWallet;
  readonly multisig: MultisigClient;
  readonly deployment: DeploymentCache;
  readonly paint: () => void;
};

const hydrateMultisigs = async (
  activeView: WalletView,
  selectedMultisigId: string | null,
  cached: RenderData["multisigs"],
  multisig: MultisigClient,
): Promise<Pick<RenderData, "multisigs" | "multisigsError">> => {
  const loaded = await multisig.loadMultisigs();
  if (loaded === "error") {
    return { multisigs: cached, multisigsError: true };
  }
  const ids =
    activeView === "multisigs"
      ? loaded.multisigs.map((view) => view.record.id)
      : (activeView === "multisig-home" ||
            activeView === "multisig-detail" ||
            activeView === "multisig-signers" ||
            activeView === "multisig-track" ||
            activeView === "multisig-receive") &&
          selectedMultisigId
        ? [selectedMultisigId]
        : [];
  if (
    activeView !== "multisigs" &&
    activeView !== "multisig-home" &&
    activeView !== "multisig-detail" &&
    activeView !== "multisig-signers" &&
    activeView !== "multisig-track" &&
    activeView !== "multisig-receive"
  ) {
    return { multisigs: loaded, multisigsError: false };
  }
  await Promise.all(ids.map((id) => multisig.refreshMultisig(id).catch(() => null)));
  const reloaded = await multisig.loadMultisigs();
  if (reloaded === "error") {
    return { multisigs: loaded, multisigsError: true };
  }
  return {
    multisigs: reloaded,
    multisigsError: false,
  };
};

const nftSnapshot = (
  indexed: RenderData["indexedNfts"],
  watched: RenderData["watchedNfts"],
): RenderData["discoveredNfts"] => {
  const combined = new Map(indexed.map((nft) => [nft.id, nft]));
  // Explicitly watched metadata wins a same-id indexer record: it comes from
  // the wallet's privacy-gated on-chain metadata path rather than the directory.
  for (const nft of watched) {
    combined.set(nft.id, nft);
  }
  return [...combined.values()];
};

/**
 * Loads the view-scoped network data in parallel and repaints once it lands.
 * Each loader is best-effort: a rejected fetch leaves the cached value intact
 * rather than blanking the screen.
 */
export const hydrateView = async (deps: HydrateDeps): Promise<void> => {
  const {
    status,
    activeView,
    selectedMultisigId,
    selectedTokenId,
    cache,
    wallet,
    multisig,
    deployment,
    isCurrent = () => true,
    paint,
  } = deps;
  const primaryJobs: Promise<unknown>[] = [];
  const deferredJobs: Promise<unknown>[] = [];
  const streamingJobs: Promise<unknown>[] = [];
  const fill = <T>(load: Promise<T>, assign: (value: T) => void, deferred = false): void => {
    (deferred ? deferredJobs : primaryJobs).push(
      load
        .then((value) => {
          if (isCurrent()) {
            assign(value);
          }
        })
        .catch(() => undefined),
    );
  };
  const stream = <T>(load: Promise<T>, assign: (value: T) => void): void => {
    streamingJobs.push(
      load
        .then((value) => {
          if (isCurrent()) {
            assign(value);
            paint();
          }
        })
        .catch(() => undefined),
    );
  };
  if (
    activeView === "home" ||
    activeView === "send" ||
    activeView === "swap" ||
    activeView === "tokens" ||
    activeView === "token-detail" ||
    activeView === "multisig-home" ||
    activeView === "multisig-propose"
  ) {
    if (
      activeView === "home" ||
      activeView === "send" ||
      activeView === "swap" ||
      activeView === "tokens" ||
      activeView === "token-detail"
    ) {
      fill(wallet.loadBalances(), (value) => {
        cache.balances =
          "balances" in value &&
          (value.accountId !== status.activeAccountId || value.networkId !== status.networkId)
            ? { error: "balances unavailable" }
            : value;
      });
    }
    fill(wallet.loadPrices(), (value) => {
      cache.prices = value.prices;
      cache.changes = value.changes;
      cache.priceAsOf = value.asOf;
      cache.priceStale = value.stale;
    });
  }
  if (activeView === "home") {
    fill(
      deployment.load(status, activeView),
      (value) => {
        cache.deployment = value;
      },
      true,
    );
  }
  if (activeView === "activity" || activeView === "home" || activeView === "multisig-home") {
    fill(
      wallet.loadActivity(activeView === "home" ? undefined : (selectedMultisigId ?? undefined)),
      (value) => {
        cache.transactions = value.entries;
        cache.historyUnavailable = value.historyUnavailable;
      },
      activeView !== "activity",
    );
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
  if (
    activeView === "home" ||
    activeView === "nfts" ||
    activeView === "nft-hidden" ||
    activeView === "nft-detail" ||
    activeView === "nft-send"
  ) {
    const nftScope = `${status.networkId}:${status.activeAccountId ?? "none"}`;
    // Explicitly watched NFTs take the fast lane: no indexer wait, immediate
    // repaint when their verified metadata lands, and no wait for balances,
    // prices, activity, or auto-discovery.
    stream(wallet.loadWatchedNfts(nftScope), (value) => {
      cache.watchedNfts = value;
      cache.discoveredNfts = nftSnapshot(cache.indexedNfts, cache.watchedNfts);
    });
    fill(
      wallet.discoverNfts(false, nftScope),
      (value) => {
        cache.indexedNfts = value;
        cache.discoveredNfts = nftSnapshot(cache.indexedNfts, cache.watchedNfts);
      },
      activeView === "home",
    );
  }
  if (
    activeView === "home" ||
    activeView === "activity" ||
    activeView === "settings" ||
    activeView === "account" ||
    activeView === "send" ||
    activeView === "multisigs" ||
    activeView === "multisig-home" ||
    activeView === "multisig-detail" ||
    activeView === "multisig-signers" ||
    activeView === "multisig-track" ||
    activeView === "multisig-receive" ||
    activeView === "multisig-watch" ||
    activeView === "multisig-propose" ||
    activeView === "multisig-deploy"
  ) {
    primaryJobs.push(
      hydrateMultisigs(activeView, selectedMultisigId, cache.multisigs, multisig).then((value) => {
        if (isCurrent()) {
          Object.assign(cache, value);
        }
      }),
    );
  }
  if (
    (activeView === "multisig-home" ||
      activeView === "multisig-propose" ||
      activeView === "multisig-receive") &&
    selectedMultisigId
  ) {
    fill(multisig.loadBalances(selectedMultisigId), (value) => {
      cache.multisigBalanceId = selectedMultisigId;
      cache.multisigBalances =
        "balances" in value &&
        (value.accountId !== selectedMultisigId || value.networkId !== status.networkId)
          ? { error: "multisig balances unavailable" }
          : value;
    });
  }
  if (activeView === "multisig-home" && selectedMultisigId) {
    const multisigNftScope = `${status.networkId}:${selectedMultisigId}`;
    stream(wallet.discoverNfts(true, multisigNftScope, selectedMultisigId), (value) => {
      cache.multisigNftId = selectedMultisigId;
      cache.multisigNfts = value;
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
  const flush = async (jobs: readonly Promise<unknown>[]): Promise<void> => {
    if (jobs.length > 0) {
      await Promise.all(jobs);
      if (isCurrent()) {
        paint();
      }
    }
  };
  await flush(primaryJobs);
  await flush(deferredJobs);
  await Promise.all(streamingJobs);
};
