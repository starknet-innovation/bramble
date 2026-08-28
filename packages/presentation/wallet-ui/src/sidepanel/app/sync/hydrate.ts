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
import type { RefreshReason } from "./refresh-scheduler";

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
  readonly refreshReason?: RefreshReason;
};

const hydrateMultisigs = async (
  cached: RenderData["multisigs"],
  multisig: MultisigClient,
  networkId: string,
  cachedOnly = false,
): Promise<Pick<RenderData, "multisigs" | "multisigsError" | "multisigsNetworkId">> => {
  const loaded = await multisig.loadMultisigs(cachedOnly);
  if (loaded === "error") {
    return { multisigs: cached, multisigsError: true, multisigsNetworkId: null };
  }
  return { multisigs: loaded, multisigsError: false, multisigsNetworkId: networkId };
};

const hydrateSelectedMultisig = async (
  cached: RenderData["multisigs"],
  multisig: MultisigClient,
  multisigId: string,
  force: boolean,
): Promise<Pick<RenderData, "multisigs" | "multisigsError">> => {
  const loaded = await multisig.refreshMultisig(multisigId, force);
  const existing = cached.multisigs.findIndex((view) => view.record.id === multisigId);
  const locallyConfirmed =
    existing >= 0 && cached.multisigs[existing]?.record.currentConfig !== undefined;
  // Ambient refreshes may improve cached UI state, but they never revoke a
  // locally confirmed signer view on a transient RPC failure. Prepare, sign,
  // and submit still revalidate authority in the privileged background.
  if (
    locallyConfirmed &&
    (loaded === "error" || loaded.multisig.authorityStatus === "network-unavailable")
  ) {
    return {
      multisigs:
        loaded === "error"
          ? cached
          : {
              intents: [
                ...loaded.intents,
                ...cached.intents.filter((intent) => intent.accountId !== multisigId),
              ],
              multisigs: cached.multisigs,
            },
      multisigsError: false,
    };
  }
  if (loaded === "error") return { multisigs: cached, multisigsError: true };
  return {
    multisigs: {
      intents: [
        ...loaded.intents,
        ...cached.intents.filter((intent) => intent.accountId !== multisigId),
      ],
      multisigs:
        existing < 0
          ? [loaded.multisig, ...cached.multisigs]
          : cached.multisigs.map((view, index) => (index === existing ? loaded.multisig : view)),
    },
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

const SELECTED_MULTISIG_VIEWS = new Set<WalletView>([
  "multisig-home",
  "multisig-detail",
  "multisig-signers",
  "multisig-track",
  "multisig-receive",
  "multisig-propose",
  "multisig-deploy",
]);

const shouldRefreshSelectedMultisig = (
  activeView: WalletView,
  registryView: boolean,
  authorityCriticalView: boolean,
  selectedMultisigId: string | null,
  selectedNeedsRefresh: boolean,
  multisigsNetworkId: string | null,
  networkId: string,
): selectedMultisigId is string =>
  (!registryView || authorityCriticalView) &&
  selectedMultisigId !== null &&
  selectedNeedsRefresh &&
  multisigsNetworkId === networkId &&
  SELECTED_MULTISIG_VIEWS.has(activeView);

const hydrateCachedView = async (
  deps: HydrateDeps,
  walletBalanceView: boolean,
  priceView: boolean,
  activityView: boolean,
  registryView: boolean,
  multisigBalanceView: boolean,
  walletNftView: boolean,
  multisigNftView: boolean,
): Promise<void> => {
  const {
    status,
    activeView,
    selectedMultisigId,
    cache,
    wallet,
    multisig,
    isCurrent = () => true,
    paint,
  } = deps;
  const jobs: Promise<unknown>[] = [];
  const cached = <T>(load: Promise<T>, assign: (value: T) => void): void => {
    jobs.push(
      load
        .then((value) => {
          if (isCurrent()) assign(value);
        })
        .catch(() => undefined),
    );
  };
  const cachedStream = <T>(load: Promise<T>, assign: (value: T) => void): void => {
    void load
      .then((value) => {
        if (isCurrent()) {
          assign(value);
          paint();
        }
      })
      .catch(() => undefined);
  };
  if (walletBalanceView) {
    cached(wallet.loadBalances(true), (value) => {
      if (
        "balances" in value &&
        value.accountId === status.activeAccountId &&
        value.networkId === status.networkId
      )
        cache.balances = value;
    });
  }
  if (priceView) {
    cached(wallet.loadPrices(true), (value) => {
      cache.prices = value.prices;
      cache.changes = value.changes;
      cache.priceAsOf = value.asOf;
      cache.priceStale = value.stale;
    });
  }
  if (activityView) {
    cached(
      wallet.loadActivity(
        activeView === "home" ? undefined : (selectedMultisigId ?? undefined),
        true,
      ),
      (value) => {
        cache.transactions = value.entries;
      },
    );
  }
  if (registryView) {
    cached(hydrateMultisigs(cache.multisigs, multisig, status.networkId, true), (value) =>
      Object.assign(cache, value),
    );
  }
  if (multisigBalanceView && selectedMultisigId) {
    cached(multisig.loadBalances(selectedMultisigId, true), (value) => {
      if (
        "balances" in value &&
        value.accountId === selectedMultisigId &&
        value.networkId === status.networkId
      ) {
        cache.multisigBalanceId = selectedMultisigId;
        cache.multisigBalances = value;
      }
    });
  }
  if (walletNftView) {
    const scope = `${status.networkId}:${status.activeAccountId ?? "none"}`;
    cachedStream(wallet.loadWatchedNfts(scope, true), (value) => {
      cache.watchedNfts = value;
      cache.discoveredNfts = nftSnapshot(cache.indexedNfts, cache.watchedNfts);
    });
    cachedStream(wallet.discoverNfts(false, scope, undefined, true), (value) => {
      cache.indexedNfts = value;
      cache.discoveredNfts = nftSnapshot(cache.indexedNfts, cache.watchedNfts);
    });
  }
  if (multisigNftView && selectedMultisigId) {
    const scope = `${status.networkId}:${selectedMultisigId}`;
    cachedStream(wallet.discoverNfts(true, scope, selectedMultisigId, true), (value) => {
      cache.multisigNftId = selectedMultisigId;
      cache.multisigNfts = value;
    });
  }
  if (jobs.length > 0) {
    await Promise.all(jobs);
    if (isCurrent()) paint();
  }
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
    refreshReason,
    isCurrent = () => true,
    paint,
  } = deps;
  const walletBalanceView =
    activeView === "home" ||
    activeView === "send" ||
    activeView === "swap" ||
    activeView === "tokens" ||
    activeView === "token-detail";
  const priceView =
    walletBalanceView || activeView === "multisig-home" || activeView === "multisig-propose";
  const activityView =
    activeView === "activity" || activeView === "home" || activeView === "multisig-home";
  const registryView = cache.multisigsNetworkId !== status.networkId || activeView === "multisigs";
  const multisigBalanceView =
    selectedMultisigId !== null &&
    (activeView === "multisig-home" ||
      activeView === "multisig-propose" ||
      activeView === "multisig-receive");
  const walletNftView =
    activeView === "home" ||
    activeView === "nfts" ||
    activeView === "nft-hidden" ||
    activeView === "nft-detail" ||
    activeView === "nft-send";
  const multisigNftView = activeView === "multisig-home" && selectedMultisigId !== null;
  const authorityCriticalView =
    activeView === "multisig-detail" ||
    activeView === "multisig-signers" ||
    activeView === "multisig-propose" ||
    activeView === "multisig-deploy";
  const selectedMultisig = cache.multisigs.multisigs.find(
    (view) => view.record.id === selectedMultisigId,
  );
  const selectedNeedsRefresh =
    refreshReason === "action" ||
    authorityCriticalView ||
    selectedMultisig?.record.currentConfig === undefined;
  await hydrateCachedView(
    deps,
    walletBalanceView,
    priceView,
    activityView,
    registryView,
    multisigBalanceView,
    walletNftView,
    multisigNftView,
  );
  const primaryJobs: Promise<unknown>[] = [];
  const deferredJobs: Array<() => Promise<unknown>> = [];
  const streamingJobs: Promise<unknown>[] = [];
  const fill = <T>(
    load: Promise<T> | (() => Promise<T>),
    assign: (value: T) => void,
    deferred = false,
  ): void => {
    const start = () =>
      (typeof load === "function" ? load() : load)
        .then((value) => {
          if (isCurrent()) {
            assign(value);
          }
        })
        .catch(() => undefined);
    if (deferred) deferredJobs.push(start);
    else primaryJobs.push(start());
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
  if (priceView) {
    if (walletBalanceView) {
      fill(wallet.loadBalances(false, refreshReason === "action"), (value) => {
        if ("balances" in value) {
          cache.balances =
            value.accountId !== status.activeAccountId || value.networkId !== status.networkId
              ? { error: "balances unavailable" }
              : value;
        } else if (!("error" in cache.balances)) {
          cache.balances = { ...cache.balances, stale: true };
        } else {
          cache.balances = value;
        }
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
      () => deployment.load(status, activeView),
      (value) => {
        cache.deployment = value;
      },
      true,
    );
  }
  if (activityView) {
    fill(
      () =>
        wallet.loadActivity(
          activeView === "home" ? undefined : (selectedMultisigId ?? undefined),
          false,
          activeView === "activity" && refreshReason !== "ambient",
        ),
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
  if (activeView === "allowances" && refreshReason !== "ambient") {
    fill(wallet.loadAllowances(), (value) => {
      cache.allowances = value;
    });
  }
  // Home paints the last verified NFT snapshot from the cached phase above.
  // Full indexer discovery can fan out into many ownership proofs, so only NFT
  // surfaces refresh it live instead of turning an idle dashboard into a scan.
  if (walletNftView && activeView !== "home" && refreshReason !== "ambient") {
    const nftScope = `${status.networkId}:${status.activeAccountId ?? "none"}`;
    // Explicitly watched NFTs take the fast lane: no indexer wait, immediate
    // repaint when their verified metadata lands, and no wait for balances,
    // prices, activity, or auto-discovery.
    stream(wallet.loadWatchedNfts(nftScope), (value) => {
      cache.watchedNfts = value;
      cache.discoveredNfts = nftSnapshot(cache.indexedNfts, cache.watchedNfts);
    });
    fill(
      () => wallet.discoverNfts(false, nftScope),
      (value) => {
        cache.indexedNfts = value;
        cache.discoveredNfts = nftSnapshot(cache.indexedNfts, cache.watchedNfts);
      },
    );
  }
  if (registryView) {
    primaryJobs.push(
      hydrateMultisigs(cache.multisigs, multisig, status.networkId).then((value) => {
        if (isCurrent()) {
          Object.assign(cache, value);
        }
      }),
    );
  }
  if (
    shouldRefreshSelectedMultisig(
      activeView,
      registryView,
      authorityCriticalView,
      selectedMultisigId,
      selectedNeedsRefresh,
      cache.multisigsNetworkId,
      status.networkId,
    )
  ) {
    primaryJobs.push(
      hydrateSelectedMultisig(
        cache.multisigs,
        multisig,
        selectedMultisigId,
        authorityCriticalView,
      ).then((value) => {
        if (isCurrent()) Object.assign(cache, value);
      }),
    );
  }
  if (multisigBalanceView && selectedMultisigId) {
    fill(multisig.loadBalances(selectedMultisigId, false, refreshReason === "action"), (value) => {
      cache.multisigBalanceId = selectedMultisigId;
      if ("balances" in value) {
        cache.multisigBalances =
          value.accountId !== selectedMultisigId || value.networkId !== status.networkId
            ? { error: "multisig balances unavailable" }
            : value;
      } else if (!("error" in cache.multisigBalances)) {
        cache.multisigBalances = { ...cache.multisigBalances, stale: true };
      } else {
        cache.multisigBalances = value;
      }
    });
  }
  if (activeView === "multisig-home" && selectedMultisigId && refreshReason !== "ambient") {
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
  await flush(deferredJobs.map((start) => start()));
  await Promise.all(streamingJobs);
};
