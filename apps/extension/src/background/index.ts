/**
 * MV3 background entrypoint. All privileged wallet state stays behind this worker.
 */

import { untrustedFetch } from "@mc-wallet/core/http-json";
import { createKrustyKms } from "@mc-wallet/kms-krusty/adapter";
import { createMultisigStore } from "@mc-wallet/multisig/repository";
import { createOriginGuard } from "@mc-wallet/permissions/blocklist";
import { createOriginHistoryStore } from "@mc-wallet/permissions/origin-history";
import { createPhishingFeed } from "@mc-wallet/permissions/phishing-feed";
import { createPriceService, unavailablePriceService } from "@mc-wallet/portfolio/prices";
import { createStrk20MaturityStore } from "@mc-wallet/privacy/maturity-store";
import {
  createOfficialStrk20Service,
  type PrivacySdkRuntime,
} from "@mc-wallet/privacy/official-sdk-service";
import { unavailableStrk20Service } from "@mc-wallet/privacy/service";
import {
  type ApprovalSurfacePreference,
  createPreferencesStore,
  type WalletPreferences,
} from "@mc-wallet/settings/preferences";
import { createActivityLog, systemClock } from "@mc-wallet/transactions/activity";
import { createAllowanceStore } from "@mc-wallet/transactions/allowance-store";
import { createSwapService, unavailableSwapService } from "@mc-wallet/transactions/avnu";
import { createEncryptedStore, type EncryptedStore } from "@mc-wallet/vault/encrypted-store";
import { createWalletVaultService } from "@mc-wallet/vault/service";
import { VAULT_MIGRATION_STORE_KEY, VAULT_STORE_KEY } from "@mc-wallet/vault/store-migration";
import type { WalletEventMessage } from "@mc-wallet/wallet-protocol/events";
import * as krustyModule from "/vendor/krusty-kms/pkg/krusty_kms_wasm.js";
import * as privacySdkModule from "/vendor/starknet-privacy/sdk/starknet-sdk.min.js";
import {
  createBrowserLocalStore,
  createBrowserSessionStore,
  createBrowserSyncStore,
  requireTrustedStorageAccess,
} from "../browser-storage";
import { createWalletReader } from "./accounts/wallet-reader";
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
let approvalSurfacePreference: ApprovalSurfacePreference = "side-panel";
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
  store: preferences,
});
void preferences
  .then(async (store) => {
    updateApprovalSurface((await store?.read())?.approvalSurface ?? "side-panel");
  })
  .catch(() => undefined);
// The read-only slice of the fail-closed adapter above, handed to collaborators
// that must never mutate preferences. It inherits the adapter's single
// "preferences unavailable" refusal, so a storage lockdown failure rejects here
// instead of silently answering from a half-built store — the explorer read
// lane (MCW-V09-129) treats that rejection as "not permitted", narrowing
// disclosure rather than widening it.
const readPreferences = (): Promise<WalletPreferences> => preferenceStore.read();
const activityLog = (() => {
  try {
    return createActivityLog({ store: createBrowserLocalStore() });
  } catch {
    return undefined;
  }
})();
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
    ? createOfficialStrk20Service({
        maturityStore: strk20MaturityStore,
        nowSeconds: () => Math.floor(systemClock() / 1_000),
        sdk: privacySdkModule as unknown as PrivacySdkRuntime,
      })
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
const handleMessage = createMessageHandler(walletReader, runtime?.id ?? "", {
  activeStateCoordinator,
  approvals,
  session,
  preferencesStore: preferenceStore,
  runtimeRpc,
  originGuard,
  ...(activityLog ? { activity: activityLog } : {}),
  ...(originHistory ? { originHistory } : {}),
  prices: priceService,
  swap: swapService,
  ...(allowanceLog ? { allowanceStore: allowanceLog } : {}),
  multisigDeploymentReviews,
  multisigStore: multisigLog,
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
