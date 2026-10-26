/**
 * MV3 background entrypoint. All privileged wallet state stays behind this worker.
 */

import { untrustedFetch } from "@bramble/core/http-json";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { createNostrCoordinationStore } from "@bramble/multisig/coordination";
import { createMultisigStore } from "@bramble/multisig/repository";
import { createOriginGuard } from "@bramble/permissions/blocklist";
import { createOriginHistoryStore } from "@bramble/permissions/origin-history";
import { createPhishingFeed } from "@bramble/permissions/phishing-feed";
import { createPriceService, unavailablePriceService } from "@bramble/portfolio/prices";
import { createStrk20MaturityStore } from "@bramble/privacy/maturity-store";
import {
  createOfficialStrk20Service,
  type PrivacySdkRuntime,
} from "@bramble/privacy/official-sdk-service";
import { unavailableStrk20Service } from "@bramble/privacy/service";
import {
  type ApprovalSurfacePreference,
  createPreferencesStore,
  type WalletPreferences,
} from "@bramble/settings/preferences";
import { setReliabilityDiagnosticsEnabled } from "@bramble/starknet/rpc-diagnostics";
import { createActivityLog, systemClock } from "@bramble/transactions/activity";
import { createSwapService, unavailableSwapService } from "@bramble/transactions/avnu";
import { createEncryptedStore, type EncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import { VAULT_MIGRATION_STORE_KEY, VAULT_STORE_KEY } from "@bramble/vault/store-migration";
import type { WalletEventMessage } from "@bramble/wallet-protocol/events";
import * as krustyModule from "/dependencies/krusty-kms/krusty_kms_wasm.js";
import * as privacySdkModule from "/vendor/starknet-privacy/sdk/starknet-sdk.min.js";
import {
  createBrowserLocalStore,
  createBrowserSessionStore,
  createBrowserSyncStore,
  requireTrustedStorageAccess,
} from "../browser-storage";
import { resolveExtensionApi } from "../extension-api";
import { createPendingDeployments } from "./accounts/pending-deployments";
import { createWalletReader } from "./accounts/wallet-reader";
import { observeTechnicalDataConsent, technicalDataAllowed } from "./analytics/data-consent";
import {
  analyticsPlatform,
  analyticsReleaseChannel,
  createGatewayAnalytics,
  randomAnalyticsUuid,
  withGatewayAnalyticsFlows,
} from "./analytics/gateway-analytics";
import { createApprovalKeepAlive } from "./approvals/approval-keepalive";
import { setApprovalNotifier } from "./approvals/approval-notifier";
import {
  bindToolbarActivation,
  configureApprovalSurface,
  createApprovalSurfaceOpener,
  showPendingApprovals,
} from "./approvals/approval-surface";
import { createApprovalQueue } from "./approvals/approvals";
import { createSignatureWaiters } from "./approvals/signature-waiters";
import { createArgentMultisigDeploymentReviews } from "./multisig/multisig-deployment-reviews";
import { openOnboardingOnInstall } from "./onboarding/onboarding-surface";
import { createRecoveryDiscoveryCache } from "./onboarding/recovery-cache";
import { createRankedAllowanceStore } from "./portfolio/allowance-log";
import { createBalanceSnapshotStore } from "./portfolio/balance-snapshots";
import { createNftSnapshotStore } from "./portfolio/nft-snapshots";
import { createStrk20FeeReference } from "./privacy/strk20-fee-reference";
import { createStrk20JobRegistry } from "./privacy/strk20-preparation-jobs";
import { createStrk20WalletPreparationStore } from "./privacy/strk20-wallet-preparations";
import { createMessageHandler } from "./routing/messages";
import type { BackgroundBrowser } from "./runtime/background-browser";
import { announcesApprovalsChange, walletEventBroadcasts } from "./runtime/events";
import { schedulePhishingFeedRefresh } from "./runtime/phishing-feed-alarm";
import { createDefaultRuntimeRpc } from "./runtime/runtime-rpc";
import {
  createActiveStateCoordinator,
  reconcileUnlockedActiveAccount,
} from "./runtime/runtime-state";
import { createBackgroundUnlockSession } from "./runtime/unlock-session-boot";
import { createUpdateReady } from "./runtime/update-ready";
import { createBackgroundPreferences } from "./settings/preferences-adapter";
import { startTransactionMonitor } from "./transactions/tx-monitor";

const extensionApi = resolveExtensionApi<BackgroundBrowser>();
const runtime = extensionApi?.runtime;
const tabs = extensionApi?.tabs;
declare const __MC_BUILD_BRANCH__: string | undefined;
let approvalSurfacePreference: ApprovalSurfacePreference = "side-panel";
let productAnalyticsEnabled = false;
const updateApprovalSurface = (preference: ApprovalSurfacePreference): void => {
  approvalSurfacePreference = preference;
  void configureApprovalSurface(extensionApi, preference).catch(() => undefined);
};
const approvals = createApprovalQueue();
// The held-response registry lives here rather than inside the router context
// so the worker keepalive below can watch it alongside the approval queue: a
// held dapp response is the thing a suspension destroys, and the two counts
// together are what "a decision is still pending" means (#350).
const signatureWaiters = createSignatureWaiters();
// Firefox tears down a non-persistent event page on its idle timer even while
// a prompt is unanswered, and the queue and the waiters above are in-memory
// only, so one parent API call per interval is what holds the page open until
// the user decides. The interval runs only while something is pending.
const approvalKeepAlive = createApprovalKeepAlive({
  isPending: () => approvals.list().length > 0 || signatureWaiters.pending() > 0,
  ...(runtime?.getPlatformInfo
    ? { keepAlive: () => void runtime.getPlatformInfo?.()?.catch(() => undefined) }
    : {}),
});
const sessionStore = (() => {
  try {
    return createBrowserSessionStore();
  } catch {
    return undefined;
  }
})();
const multisigDeploymentReviews = createArgentMultisigDeploymentReviews(sessionStore);
const recoveryDiscovery = createRecoveryDiscoveryCache(sessionStore);
// The vault store is created up front so the unlock session can drop its
// cached AES key on lock/expiry, and so its PBKDF2-derived key is reused across
// operations for the life of an unlock rather than re-derived every time.
const vaultStores: { readonly primary: EncryptedStore; readonly staging: EncryptedStore } | null =
  (() => {
    try {
      const store = createBrowserLocalStore();
      const freshnessStore = createBrowserSyncStore();
      // The vault blob and its freshness records both live in areas a content
      // script can read and write on Firefox, which cannot restrict them; an
      // attacker there rolls back the pair together and it stays
      // self-consistent. `sessionStore` is `storage.session`, closed to content
      // scripts on every browser, so it carries a second copy of the commit
      // state that the rolled-back one has to agree with. Absent where the
      // runtime has no session storage, which leaves the durable record as the
      // only authority — the behaviour before this shadow existed.
      return {
        // Only the primary mirrors its commit record into `storage.local`, so a
        // lost `storage.sync` record does not lock the vault; see
        // `createEncryptedStore` for why staging must not.
        primary: createEncryptedStore(store, VAULT_STORE_KEY, freshnessStore, sessionStore, true),
        staging: createEncryptedStore(
          store,
          VAULT_MIGRATION_STORE_KEY,
          freshnessStore,
          sessionStore,
        ),
      };
    } catch {
      return null;
    }
  })();
const session = createBackgroundUnlockSession({
  alarms: extensionApi?.alarms,
  sessionStore,
  clearKeyCaches: () => {
    for (const store of [vaultStores?.primary, vaultStores?.staging]) {
      store?.clearKeys();
    }
    // Declared below; this runs only when the session locks, long after.
    void wallet.then((service) => service?.clearGrantCache());
  },
});
// Storage lockdown is a startup prerequisite, not a best-effort side effect.
// Requests remain fail-closed if Chrome cannot remove content-script access.
const storageReady = requireTrustedStorageAccess();
const sessionReady = storageReady.then(() => session.restore());
const wallet = vaultStores
  ? storageReady
      .then(() =>
        createWalletVaultService({
          encryptedStore: vaultStores.primary,
          kms: createKrustyKms(krustyModule),
          migrationStore: vaultStores.staging,
        }),
      )
      .catch(() => null)
  : Promise.resolve(null);
const preferences = storageReady
  .then(() => createPreferencesStore({ store: createBrowserLocalStore() }))
  .catch(() => null);
const preferenceStore = createBackgroundPreferences({
  onApprovalSurface: updateApprovalSurface,
  onProductAnalytics: (enabled) => {
    productAnalyticsEnabled = enabled;
  },
  onReliabilityDiagnostics: setReliabilityDiagnosticsEnabled,
  store: preferences,
});
// The browser's data-collection consent outranks the wallet's preference one
// way only: it can withhold analytics, never enable what the user turned off
// (Firefox asks at install for the optional `technicalAndInteraction`). Re-read
// on every permission change so a revoke takes effect without a restart.
let technicalDataConsent = true;
const refreshTechnicalDataConsent = async (): Promise<void> => {
  technicalDataConsent = await technicalDataAllowed(extensionApi?.permissions);
};
observeTechnicalDataConsent(extensionApi?.permissions, () => {
  void refreshTechnicalDataConsent();
});
const preferenceSignalsReady = preferences
  .then(async (store) => {
    const stored = await store?.read();
    updateApprovalSurface(stored?.approvalSurface ?? "side-panel");
    productAnalyticsEnabled = store ? (stored?.productAnalytics ?? true) : false;
    setReliabilityDiagnosticsEnabled(stored?.reliabilityDiagnostics ?? false);
    await refreshTechnicalDataConsent();
  })
  .catch(() => undefined);
// The read-only slice of the fail-closed adapter above. A storage lockdown
// failure rejects here instead of answering from a half-built store, and the
// explorer read lane (MCW-V09-129) treats that as "not permitted".
const readPreferences = (): Promise<WalletPreferences> => preferenceStore.read();
const nativeFetch = globalThis.fetch.bind(globalThis);
const browserNavigator = globalThis.navigator as Navigator & { readonly brave?: unknown };
const gatewayAnalytics = createGatewayAnalytics({
  enabled: async () => {
    await preferenceSignalsReady;
    return productAnalyticsEnabled && technicalDataConsent;
  },
  http: nativeFetch,
  metadata: {
    appVersion: runtime?.getManifest?.().version ?? "",
    platform: analyticsPlatform(browserNavigator.userAgent, browserNavigator.brave !== undefined),
    releaseChannel: analyticsReleaseChannel(
      typeof __MC_BUILD_BRANCH__ === "string" ? __MC_BUILD_BRANCH__ : "",
    ),
  },
  randomUuid: randomAnalyticsUuid,
  store: createBrowserLocalStore(),
});
// The pinned privacy SDK performs discovery and proving through its own
// uninjectable fetch calls. One permanent exact-origin wrapper is therefore the
// shared boundary for it and starknet.js; every non-gateway request is passed
// through unchanged.
globalThis.fetch = gatewayAnalytics.fetch as typeof globalThis.fetch;
const activityLog = (() => {
  try {
    return createActivityLog({ store: createBrowserLocalStore() });
  } catch {
    return undefined;
  }
})();
// Public chain data only. The adapter is restricted to trusted extension
// contexts at startup; wallet secrets remain exclusively in the encrypted vault.
const balanceSnapshots = createBalanceSnapshotStore(createBrowserLocalStore());
const pendingDeployments = createPendingDeployments(createBrowserLocalStore());
const nftSnapshots = createNftSnapshotStore(createBrowserLocalStore());
const originHistory = (() => {
  try {
    return createOriginHistoryStore({ now: systemClock, store: createBrowserLocalStore() });
  } catch {
    return undefined;
  }
})();
const allowanceLog = (() => {
  try {
    return createRankedAllowanceStore(createBrowserLocalStore(), readPreferences);
  } catch {
    return undefined;
  }
})();
const priceService = (() => {
  try {
    return createPriceService({ http: untrustedFetch, store: createBrowserLocalStore() });
  } catch {
    return unavailablePriceService;
  }
})();
// AVNU swap aggregator boundary (quotes + build calldata); fails closed when
// fetch is unavailable in this runtime.
const swapService = (() => {
  try {
    return createSwapService({ http: untrustedFetch });
  } catch {
    return unavailableSwapService;
  }
})();
// Durable intent and operation claims are part of the signing safety model.
// If local storage is unavailable, fail background initialization rather than
// silently accepting signatures or broadcasts into a volatile registry.
const multisigLog = createMultisigStore({ store: createBrowserLocalStore() });
const nostrCoordinationLog = createNostrCoordinationStore({ store: createBrowserLocalStore() });
// Live phishing feed, fetched under an explicit host permission, cached locally,
// and refreshed on worker start and on a recurring alarm once its TTL lapses.
// The guard reads its in-memory snapshot on every check; the bundled seed list
// in blocklist.ts is always enforced, before the first fetch and offline too.
const phishingFeed = (() => {
  try {
    return createPhishingFeed({ fetch: untrustedFetch, store: createBrowserLocalStore() });
  } catch {
    return null;
  }
})();
const originGuard = createOriginGuard(() => phishingFeed?.blockedDomains() ?? new Set());
void storageReady
  .then(() => {
    if (phishingFeed) schedulePhishingFeedRefresh(extensionApi?.alarms, phishingFeed.refresh);
  })
  .catch(() => undefined);
// Fails closed to the stub service when browser storage is unavailable, the
// only thing that can throw here (markers live in local storage, mc-wallet
// 668). It cannot be logged, so `unavailableStrk20Service` says "no privacy
// runtime is wired in this build" instead of a live failure's line.
const strk20MaturityStore = (() => {
  try {
    return createStrk20MaturityStore(createBrowserLocalStore());
  } catch {
    return undefined;
  }
})();
// Built from the real preferences reader, not the preference-free default, so
// the third-party explorer read lane obeys the user's per-network choice
// (MCW-V09-129) instead of the built-in-RPC default.
const runtimeRpc = {
  ...createDefaultRuntimeRpc({ readPreferences }),
  strk20: strk20MaturityStore
    ? withGatewayAnalyticsFlows(
        createOfficialStrk20Service({
          feeReference: createStrk20FeeReference(priceService),
          http: gatewayAnalytics.fetch,
          maturityStore: strk20MaturityStore,
          nowSeconds: () => Math.floor(systemClock() / 1_000),
          sdk: privacySdkModule as unknown as PrivacySdkRuntime,
        }),
        gatewayAnalytics.withFlow,
      )
    : unavailableStrk20Service,
};
const walletReader = createWalletReader(wallet);
const activeStateCoordinator = createActiveStateCoordinator();
const runtimeReady = sessionReady.then(async () => {
  await multisigLog.recoverSigningClaims();
  const store = await preferences;
  if (store) {
    await reconcileUnlockedActiveAccount(walletReader, session, store, activeStateCoordinator);
  }
});
// A private proof outlives one runtime request, so it runs as a tracked job
// the panel polls. While one runs, a cheap extension API call every 20 s is
// what Chrome's lifecycle guidance prescribes to keep the worker from idling
// out; the call's result is irrelevant and its failure is ignored.
const strk20Jobs = createStrk20JobRegistry({
  ...(runtime?.getPlatformInfo
    ? { keepAlive: () => void runtime.getPlatformInfo?.()?.catch(() => undefined) }
    : {}),
  now: systemClock,
});
// A reviewed preparation is held only in worker memory too, so the same
// extension API call keeps the worker alive while a confirmation sits on
// screen; an unconfirmed review retires after its lifetime and drops the hold.
const strk20Preparations = createStrk20WalletPreparationStore({
  ...(runtime?.getPlatformInfo
    ? { keepAlive: () => void runtime.getPlatformInfo?.()?.catch(() => undefined) }
    : {}),
  now: systemClock,
});
// This extension's own identity. The origin MUST come from the runtime: on
// Firefox `runtime.id` is the add-on id while pages are served from
// `moz-extension://<per-install uuid>`, so an origin built from the id matches
// nothing. An unreadable origin stays empty, which fails the gate closed.
const extensionOrigin = (): string => {
  try {
    const url = runtime?.getURL?.("");
    return url === undefined ? "" : new URL(url).origin;
  } catch {
    return "";
  }
};
const extension = { id: runtime?.id ?? "", origin: extensionOrigin() };
// Applies a downloaded update as soon as nothing is in progress (mc-wallet 708).
const updateReady = createUpdateReady({
  isBusy: () =>
    approvals.list().length > 0 ||
    signatureWaiters.pending() > 0 ||
    strk20Jobs.active() ||
    (strk20Preparations.held?.() ?? false),
  runtime,
});
const handleMessage = createMessageHandler(walletReader, extension, {
  activeStateCoordinator,
  approvals,
  waiters: signatureWaiters,
  balanceSnapshots,
  nftSnapshots,
  pendingDeployments,
  session,
  preferencesStore: preferenceStore,
  runtimeRpc,
  originGuard,
  ...(activityLog ? { activity: activityLog } : {}),
  ...(originHistory ? { originHistory } : {}),
  prices: priceService,
  recoveryDiscovery,
  swap: swapService,
  ...(allowanceLog ? { allowanceStore: allowanceLog } : {}),
  multisigDeploymentReviews,
  multisigStore: multisigLog,
  nostrCoordinationStore: nostrCoordinationLog,
  strk20Jobs,
  strk20Preparations,
  updates: updateReady,
});

// Background verification of submitted transactions. Runs on its own alarm
// cadence so a pre-confirmed transaction keeps being checked through to L1
// finality after the side panel closes, and a failure detected then is queued
// for the next time a panel opens.
if (activityLog) {
  startTransactionMonitor({
    browser: extensionApi,
    deps: {
      activity: activityLog,
      // The read-only preferences slice plus the preference-bound RPC wiring:
      // the monitor must reach the same explorer-lane decision the user chose
      // (MCW-V09-129), which `defaultRuntimeRpc` cannot answer.
      preferencesStore: { read: readPreferences },
      runtimeRpc,
    },
    now: systemClock,
    ready: storageReady,
  });
}

let broadcastQueue: Promise<void> = Promise.resolve();
const broadcastEvent = (event: WalletEventMessage): void => {
  broadcastQueue = broadcastQueue.then(async () => {
    await runtime?.sendMessage?.(event).catch(() => undefined);
    const openTabs = await tabs?.query({}).catch(() => []);
    await Promise.all(
      (openTabs ?? []).map((tab) =>
        typeof tab.id === "number"
          ? tabs?.sendMessage(tab.id, event).then(
              () => undefined,
              () => undefined,
            )
          : undefined,
      ),
    );
  });
};

// On Firefox a dapp-triggered approval cannot raise the wallet, so the toolbar
// mark is the only sign something waits; it tracks the queue on every path,
// including approve/deny `claim`s, which announce through the broadcasts below.
const refreshPendingApprovals = (): void => {
  showPendingApprovals(extensionApi, approvals.list().length);
};

const broadcastWalletEvents = (message: unknown, response: unknown): void => {
  const events = walletEventBroadcasts(message, response);
  for (const event of events) {
    broadcastEvent(event);
  }
  if (announcesApprovalsChange(events)) {
    refreshPendingApprovals();
    approvalKeepAlive.sync();
  }
};

// A held signTypedData request queues an approval and defers its response, so
// it pushes an approvals-changed signal at queue time via this notifier, which
// also covers the lazy expiry sweep. The same signal is where the pending
// decision starts and stops the worker keepalive, so a prompt left open keeps
// the event page alive and a decision or sweep releases it.
setApprovalNotifier(() => {
  broadcastEvent({ event: "approvalsChanged", type: "wallet.event" });
  refreshPendingApprovals();
  approvalKeepAlive.sync();
});

runtime?.onInstalled.addListener((details) => {
  void openOnboardingOnInstall(extensionApi, details.reason);
});
// Runs synchronously ahead of the async gating below so Chrome still counts the
// page's transient user activation; blocklisted origins and repeat opens from a
// single tab are filtered inside the opener.
const openApprovalSurface = createApprovalSurfaceOpener({
  browser: extensionApi,
  extensionId: runtime?.id ?? "",
  guard: originGuard,
  now: systemClock,
  preference: () => approvalSurfacePreference,
});
// Firefox only: routes its toolbar button to the sidebar, which Chromium does
// through setPanelBehavior instead. Registered at the top level because the
// event page is torn down when idle and a listener added later would be lost.
bindToolbarActivation(extensionApi, () => approvalSurfacePreference);
runtime?.onMessage.addListener((message, sender, sendResponse) => {
  openApprovalSurface(message, sender);
  void updateReady.track(runtimeReady.then(() => handleMessage(message, sender))).then(
    (response) => {
      sendResponse(response);
      broadcastWalletEvents(message, response);
    },
    () => {
      sendResponse({ error: "wallet request failed" });
    },
  );
  return true;
});
