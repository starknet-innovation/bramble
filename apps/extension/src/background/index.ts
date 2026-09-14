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
import { createAllowanceStore } from "@bramble/transactions/allowance-store";
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
import { createWalletReader } from "./accounts/wallet-reader";
import {
  analyticsPlatform,
  analyticsReleaseChannel,
  createGatewayAnalytics,
  randomAnalyticsUuid,
  withGatewayAnalyticsFlows,
} from "./analytics/gateway-analytics";
import { setApprovalNotifier } from "./approvals/approval-notifier";
import {
  type ApprovalSurfaceBrowser,
  configureApprovalSurface,
  createApprovalSurfaceOpener,
} from "./approvals/approval-surface";
import { createApprovalQueue } from "./approvals/approvals";
import { createArgentMultisigDeploymentReviews } from "./multisig/multisig-deployment-reviews";
import {
  type OnboardingSurfaceBrowser,
  openOnboardingOnInstall,
} from "./onboarding/onboarding-surface";
import { createRecoveryDiscoveryCache } from "./onboarding/recovery-cache";
import { createBalanceSnapshotStore } from "./portfolio/balance-snapshots";
import { createNftSnapshotStore } from "./portfolio/nft-snapshots";
import { createStrk20FeeReference } from "./privacy/strk20-fee-reference";
import { createStrk20JobRegistry } from "./privacy/strk20-preparation-jobs";
import { createMessageHandler } from "./routing/messages";
import type { RuntimeSender } from "./routing/senders";
import { walletEventBroadcasts } from "./runtime/events";
import { createDefaultRuntimeRpc } from "./runtime/runtime-rpc";
import {
  createActiveStateCoordinator,
  reconcileUnlockedActiveAccount,
} from "./runtime/runtime-state";
import type { SessionAlarmsApi } from "./runtime/session-expiry-alarm";
import { createBackgroundUnlockSession } from "./runtime/unlock-session-boot";
import { createBackgroundPreferences } from "./settings/preferences-adapter";
import { type AlarmsApi, startTransactionMonitor } from "./transactions/tx-monitor";

type RuntimeApi = {
  readonly getManifest?: () => { readonly version?: string };
  readonly getPlatformInfo?: () => Promise<unknown>;
  readonly getURL?: (path: string) => string;
  readonly id: string;
  readonly onInstalled: {
    readonly addListener: (listener: (details: { readonly reason?: string }) => void) => void;
  };
  readonly onMessage: {
    readonly addListener: (
      listener: (
        message: unknown,
        sender: RuntimeSender,
        sendResponse: (response: unknown) => void,
      ) => true,
    ) => void;
  };
  readonly sendMessage?: (message: unknown) => Promise<unknown>;
};

// Two alarm consumers, one API: recurring reconciliation cadences
// (./transactions/tx-monitor) and the one-shot unlock deadline
// (./privacy/session-expiry-alarm).
type AlarmsGlobal = { readonly alarms?: AlarmsApi & SessionAlarmsApi };

type TabsApi = {
  readonly query: (
    queryInfo: Record<string, never>,
  ) => Promise<readonly { readonly id?: number }[]>;
  readonly sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: ApprovalSurfaceBrowser &
    OnboardingSurfaceBrowser &
    AlarmsGlobal & {
      readonly runtime?: RuntimeApi;
      readonly tabs?: TabsApi;
    };
};

const extensionApi = (globalThis as ExtensionGlobal).chrome;
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
      return {
        primary: createEncryptedStore(store, VAULT_STORE_KEY, freshnessStore),
        staging: createEncryptedStore(store, VAULT_MIGRATION_STORE_KEY, freshnessStore),
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
const preferenceSignalsReady = preferences
  .then(async (store) => {
    const stored = await store?.read();
    updateApprovalSurface(stored?.approvalSurface ?? "side-panel");
    productAnalyticsEnabled = store ? (stored?.productAnalytics ?? true) : false;
    setReliabilityDiagnosticsEnabled(stored?.reliabilityDiagnostics ?? false);
  })
  .catch(() => undefined);
// The read-only slice of the fail-closed adapter above, handed to collaborators
// that must never mutate preferences. It inherits the adapter's single
// "preferences unavailable" refusal, so a storage lockdown failure rejects here
// instead of silently answering from a half-built store — the explorer read
// lane (MCW-V09-129) treats that rejection as "not permitted", narrowing
// disclosure rather than widening it.
const readPreferences = (): Promise<WalletPreferences> => preferenceStore.read();
const nativeFetch = globalThis.fetch.bind(globalThis);
const browserNavigator = globalThis.navigator as Navigator & { readonly brave?: unknown };
const gatewayAnalytics = createGatewayAnalytics({
  enabled: async () => {
    await preferenceSignalsReady;
    return productAnalyticsEnabled;
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
    return createAllowanceStore({ store: createBrowserLocalStore() });
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
// Live phishing feed: fetched from the configured source under an explicit host
// permission, cached in local storage, and refreshed on the first worker wake
// after its TTL. The guard reads the feed's in-memory snapshot on every check,
// so a refresh takes effect with no re-wiring; the bundled seed list in
// blocklist.ts is always enforced, so protection never drops below baseline
// even before the first fetch or when the source is unreachable.
const phishingFeed = (() => {
  try {
    return createPhishingFeed({ fetch: untrustedFetch, store: createBrowserLocalStore() });
  } catch {
    return null;
  }
})();
const originGuard = createOriginGuard(() => phishingFeed?.blockedDomains() ?? new Set());
void storageReady.then(() => phishingFeed?.refresh()).catch(() => undefined);
// Fails closed to the stub service when session storage is unavailable, which
// is the only thing that can throw here (`createStrk20MaturityStore` itself is
// pure construction). The reason cannot be logged — the standards check bars
// logging from production sources — so it surfaces where a user can see it
// instead: `unavailableStrk20Service` reports "no privacy runtime is wired in
// this build" rather than the generic unavailable line, which is what
// distinguishes this fallback from a live service that failed.
const strk20MaturityStore = (() => {
  try {
    return createStrk20MaturityStore(createBrowserSessionStore());
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
const handleMessage = createMessageHandler(walletReader, runtime?.id ?? "", {
  activeStateCoordinator,
  approvals,
  balanceSnapshots,
  nftSnapshots,
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

const broadcastWalletEvents = (message: unknown, response: unknown): void => {
  for (const event of walletEventBroadcasts(message, response)) {
    broadcastEvent(event);
  }
};

// A held signTypedData request queues an approval and defers its response, so
// it pushes an approvals-changed signal at queue time via this notifier.
setApprovalNotifier(() => broadcastEvent({ event: "approvalsChanged", type: "wallet.event" }));

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
runtime?.onMessage.addListener((message, sender, sendResponse) => {
  openApprovalSurface(message, sender);
  void runtimeReady
    .then(() => handleMessage(message, sender))
    .then(
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
