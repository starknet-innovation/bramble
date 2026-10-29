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
import type { ConnectedSitesState } from "../screens/support-flows";
import type { WalletView } from "../screens/views";
import type { DeploymentCache } from "./deployment-cache";
import type { RefreshReason } from "./refresh-scheduler";
import type { SignabilityCache } from "./signability-cache";

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
  readonly signability: SignabilityCache;
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

// A paint that throws on the data it was given must not stop hydration: the
// live jobs that follow are what replace bad cached data, so aborting before
// they start would leave the panel stuck on the value that broke it
// (Sherlock 239). The failed paint leaves the previous screen in place, and
// the next successful paint replaces it.
const paintIfCurrent = (isCurrent: () => boolean, paint: () => void): void => {
  if (!isCurrent()) {
    return;
  }
  try {
    paint();
  } catch {
    // Kept on the previous screen; the next paint retries with fresh data.
  }
};

const hydrateCachedView = async (
  deps: HydrateDeps,
  walletBalanceView: boolean,
  priceView: boolean,
  activityView: boolean,
  registryView: boolean,
  multisigBalanceView: boolean,
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
        cache.relays = value.relays;
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
  if (jobs.length > 0) {
    await Promise.all(jobs);
    paintIfCurrent(isCurrent, paint);
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
    signability,
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
  );
  const primaryJobs: Promise<unknown>[] = [];
  const deferredJobs: Array<() => Promise<unknown>> = [];
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
  if (priceView) {
    if (walletBalanceView) {
      fill(wallet.loadBalances(false, refreshReason === "action"), (value) => {
        if ("balances" in value) {
          cache.balances =
            value.accountId !== status.activeAccountId || value.networkId !== status.networkId
              ? { error: "balances unavailable" }
              : value;
        } else if ("loading" in cache.balances || "error" in cache.balances) {
          // No snapshot to fall back on: the failure is the answer.
          cache.balances = value;
        } else {
          cache.balances = { ...cache.balances, stale: true };
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
  // The deploy screen reads deployment fresh, before it paints Deploy: Home's
  // 60-second undeployed snapshot can outlive a send that deployed the account
  // (mc-wallet 712).
  if (activeView === "deploy-account") {
    fill(
      () => deployment.load(status, activeView, true),
      (value) => {
        cache.deployment = value;
      },
    );
  }
  if (activeView === "home") {
    fill(
      () => deployment.load(status, activeView, refreshReason === "action"),
      (value) => {
        cache.deployment = value;
      },
      true,
    );
    fill(
      () => signability.load(status, activeView, refreshReason === "action"),
      (value) => {
        cache.signability = value;
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
        cache.relays = value.relays;
      },
      activeView !== "activity",
    );
  }
  if (activeView === "receive") {
    fill(wallet.loadClassHashVerification(), (value) => {
      cache.classHashVerification = value;
    });
  }
  if (activeView === "connected-sites") {
    // A failed read keeps a list already shown (revoking still validates on
    // the background) and otherwise shows the failure, never an empty list.
    fill(
      wallet.connectedSites().then(
        (sites): ConnectedSitesState => sites,
        (): ConnectedSitesState =>
          Array.isArray(cache.connectedSites) ? cache.connectedSites : "error",
      ),
      (value) => {
        cache.connectedSites = value;
      },
    );
  }
  if (activeView === "allowances" && refreshReason !== "ambient") {
    fill(wallet.loadAllowances(), (value) => {
      cache.allowances = value;
    });
  }
  // The collectibles journey is parked: no view can reach the gallery, so the
  // wallet never runs watched-NFT metadata or indexer discovery. Restoring the
  // gallery restores these lanes with it.
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
      // A failed read keeps only this account's own last balances, marked
      // stale. Another account's balances must never be relabelled as this
      // one's (Sherlock 209).
      const previous = cache.multisigBalances;
      const ownPrevious =
        cache.multisigBalanceId === selectedMultisigId &&
        "balances" in previous &&
        previous.accountId === selectedMultisigId &&
        previous.networkId === status.networkId;
      cache.multisigBalanceId = selectedMultisigId;
      if ("balances" in value) {
        cache.multisigBalances =
          value.accountId !== selectedMultisigId || value.networkId !== status.networkId
            ? { error: "multisig balances unavailable" }
            : value;
      } else if (ownPrevious) {
        cache.multisigBalances = { ...previous, stale: true };
      } else {
        cache.multisigBalances = value;
      }
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
        cache.chartTokenId = selected.id;
      });
    }
  }
  const flush = async (jobs: readonly Promise<unknown>[]): Promise<void> => {
    if (jobs.length > 0) {
      await Promise.all(jobs);
      paintIfCurrent(isCurrent, paint);
    }
  };
  await flush(primaryJobs);
  await flush(deferredJobs.map((start) => start()));
};
