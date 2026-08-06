/**
 * MV3 background entrypoint. All privileged wallet state stays behind this worker.
 */
import * as krustyModule from "/vendor/krusty-kms/pkg/krusty_kms_wasm.js";
import * as privacySdkModule from "/vendor/starknet-privacy/sdk/starknet-sdk.min.js";
import { createKrustyKms } from "../crypto/krusty";
import type { WalletEventMessage } from "../provider/events";
import { createOriginGuard } from "../security/blocklist";
import { createPhishingFeed } from "../security/phishing-feed";
import { createSwapService, unavailableSwapService } from "../starknet/avnu";
import { MULTISIG_CLASS_ARTIFACT } from "../starknet/multisig-deploy";
import { createPriceService, unavailablePriceService } from "../starknet/prices";
import {
  createOfficialStrk20Service,
  type PrivacySdkRuntime,
} from "../starknet/strk20/official-sdk-service";
import { unavailableStrk20Service } from "../starknet/strk20/service";
import { createActivityLog, systemClock } from "../storage/activity-store";
import { createAllowanceStore } from "../storage/allowance-store";
import {
  createBrowserLocalStore,
  createBrowserSessionStore,
  hardenLocalAccess,
  hardenSessionAccess,
} from "../storage/browser-storage";
import { createEncryptedStore, type EncryptedStore } from "../storage/encrypted-store";
import { createMultisigStore } from "../storage/multisig-store";
import { createOriginHistoryStore } from "../storage/origin-history";
import {
  type ApprovalSurfacePreference,
  createPreferencesStore,
  type WalletPreferences,
} from "../storage/preferences-store";
import { createStrk20MaturityStore } from "../storage/strk20-maturity-store";
import { VAULT_MIGRATION_STORE_KEY } from "../storage/vault-store-migration";
import { createWalletVaultService, VAULT_STORE_KEY } from "../wallet/vault-service";
import { setApprovalNotifier } from "./approval-notifier";
import {
  type ApprovalSurfaceBrowser,
  configureApprovalSurface,
  requestApprovalSurface,
} from "./approval-surface";
import { createApprovalQueue } from "./approvals";
import { walletEventBroadcasts } from "./events";
import { createMessageHandler } from "./messages";
import { type OnboardingSurfaceBrowser, openOnboardingOnInstall } from "./onboarding-surface";
import { defaultRuntimeRpc } from "./runtime-rpc";
import type { RuntimeSender } from "./senders";
import { createUnlockSession, type UnlockSessionStore } from "./session";
import { type AlarmsApi, startTransactionMonitor } from "./tx-monitor";
import { createWalletReader } from "./wallet-reader";

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

type AlarmsGlobal = { readonly alarms?: AlarmsApi };

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

const SESSION_STORE_KEY = "mc-wallet:session";

const extensionApi = (globalThis as ExtensionGlobal).chrome;
const runtime = extensionApi?.runtime;
const tabs = extensionApi?.tabs;
let approvalSurfacePreference: ApprovalSurfacePreference = "side-panel";
const updateApprovalSurface = (preference: ApprovalSurfacePreference): void => {
  approvalSurfacePreference = preference;
  void configureApprovalSurface(extensionApi, preference).catch(() => undefined);
};
const approvals = createApprovalQueue();
const sessionStore: UnlockSessionStore | undefined = (() => {
  try {
    const store = createBrowserSessionStore();
    return {
      async clear() {
        await store.remove(SESSION_STORE_KEY);
      },
      async load() {
        return store.get(SESSION_STORE_KEY);
      },
      async save(state) {
        await store.set(SESSION_STORE_KEY, state);
      },
    };
  } catch {
    return undefined;
  }
})();
// The vault store is created up front so the unlock session can drop its
// cached AES key on lock/expiry, and so its PBKDF2-derived key is reused across
// operations for the life of an unlock rather than re-derived every time.
const vaultStores: { readonly primary: EncryptedStore; readonly staging: EncryptedStore } | null =
  (() => {
    try {
      const store = createBrowserLocalStore();
      return {
        primary: createEncryptedStore(store, VAULT_STORE_KEY),
        staging: createEncryptedStore(store, VAULT_MIGRATION_STORE_KEY),
      };
    } catch {
      return null;
    }
  })();
const session = createUnlockSession(undefined, undefined, sessionStore, () => {
  for (const store of [vaultStores?.primary, vaultStores?.staging]) {
    store?.clearKeys();
  }
});
const sessionReady = session.restore().catch(() => undefined);
// Restrict the in-memory session area (which mirrors the unlock passphrase
// across worker restarts) to trusted extension contexts, so content scripts
// and web pages can never read it.
void hardenSessionAccess().catch(() => undefined);
// Persistent stores are background-owned as well. Chrome otherwise exposes
// storage.local to content scripts by default, including write access to the
// encrypted vault envelope and public registries.
void hardenLocalAccess().catch(() => undefined);
const wallet = vaultStores
  ? Promise.resolve()
      .then(() =>
        createWalletVaultService({
          encryptedStore: vaultStores.primary,
          kms: createKrustyKms(krustyModule),
          migrationStore: vaultStores.staging,
        }),
      )
      .catch(() => null)
  : Promise.resolve(null);
const preferences = Promise.resolve()
  .then(() => createPreferencesStore({ store: createBrowserLocalStore() }))
  .catch(() => null);
void preferences
  .then(async (store) => {
    updateApprovalSurface((await store?.read())?.approvalSurface ?? "side-panel");
  })
  .catch(() => undefined);
const readPreferences = async (): Promise<WalletPreferences> => {
  const store = await preferences;
  if (!store) {
    throw new Error("preferences unavailable");
  }
  return store.read();
};
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
    return createPriceService({ http: (url) => fetch(url), store: createBrowserLocalStore() });
  } catch {
    return unavailablePriceService;
  }
})();
// AVNU swap aggregator boundary (quotes + build calldata); fails closed when
// fetch is unavailable in this runtime.
const swapService = (() => {
  try {
    return createSwapService({ http: (url, init) => fetch(url, init) });
  } catch {
    return unavailableSwapService;
  }
})();
const multisigLog = (() => {
  try {
    return createMultisigStore({ store: createBrowserLocalStore() });
  } catch {
    return undefined;
  }
})();
// Live phishing feed: fetched from the configured source under an explicit host
// permission, cached in local storage, and refreshed on the first worker wake
// after its TTL. The guard reads the feed's in-memory snapshot on every check,
// so a refresh takes effect with no re-wiring; the bundled seed list in
// blocklist.ts is always enforced, so protection never drops below baseline
// even before the first fetch or when the source is unreachable.
const phishingFeed = (() => {
  try {
    return createPhishingFeed({ fetch: (url) => fetch(url), store: createBrowserLocalStore() });
  } catch {
    return null;
  }
})();
const originGuard = createOriginGuard(() => phishingFeed?.blockedDomains() ?? new Set());
void phishingFeed?.refresh().catch(() => undefined);
// Loads the bundled multisig Sierra class for the explicit declare flow. The
// artifact ships inside the extension package, so this fetch never leaves the
// extension origin; the ops handler re-verifies its class hash before use.
const loadMultisigClass = async (): Promise<unknown> => {
  const url = runtime?.getURL?.(MULTISIG_CLASS_ARTIFACT);
  if (!url) {
    throw new Error("multisig class artifact unavailable");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("multisig class artifact unavailable");
  }
  return response.json();
};
const strk20MaturityStore = (() => {
  try {
    return createStrk20MaturityStore(createBrowserSessionStore());
  } catch {
    return undefined;
  }
})();
const runtimeRpc = {
  ...defaultRuntimeRpc,
  strk20: strk20MaturityStore
    ? createOfficialStrk20Service({
        maturityStore: strk20MaturityStore,
        nowSeconds: () => Math.floor(systemClock() / 1_000),
        sdk: privacySdkModule as unknown as PrivacySdkRuntime,
      })
    : unavailableStrk20Service,
};
const handleMessage = createMessageHandler(createWalletReader(wallet), runtime?.id ?? "", {
  approvals,
  session,
  preferencesStore: {
    async addCustomNetwork(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.addCustomNetwork(input);
    },
    async addNft(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.addNft(input);
    },
    async createGroup(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.createGroup(input);
    },
    async importPreferences(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      const next = await store.importPreferences(input);
      updateApprovalSurface(next.approvalSurface ?? "side-panel");
      return next;
    },
    read: readPreferences,
    async removeAddress(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.removeAddress(input);
    },
    async removeGroup(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.removeGroup(input);
    },
    async removeNft(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.removeNft(input);
    },
    async renameGroup(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.renameGroup(input);
    },
    async setAccountInGroup(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setAccountInGroup(input);
    },
    async setGroupIcon(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setGroupIcon(input);
    },
    async setNftIndexerUrl(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setNftIndexerUrl(input);
    },
    async setNftSpam(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setNftSpam(input);
    },
    async setAccountLabel(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setAccountLabel(input);
    },
    async setDisplay(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      const next = await store.setDisplay(input);
      if (input.approvalSurface !== undefined) {
        updateApprovalSurface(input.approvalSurface);
      }
      return next;
    },
    async saveAddress(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.saveAddress(input);
    },
    async setActiveNetwork(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setActiveNetwork(input);
    },
    async setRpcOverride(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setRpcOverride(input);
    },
    async setStrk20NetworkConfig(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setStrk20NetworkConfig(input);
    },
    async setTokenHidden(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.setTokenHidden(input);
    },
    async upsertToken(input) {
      const store = await preferences;
      if (!store) {
        throw new Error("preferences unavailable");
      }
      return store.upsertToken(input);
    },
  },
  runtimeRpc,
  originGuard,
  ...(activityLog ? { activity: activityLog } : {}),
  ...(originHistory ? { originHistory } : {}),
  prices: priceService,
  swap: swapService,
  ...(allowanceLog ? { allowanceStore: allowanceLog } : {}),
  ...(multisigLog ? { multisigStore: multisigLog } : {}),
  loadMultisigClass,
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
      preferencesStore: { read: readPreferences },
      runtimeRpc: defaultRuntimeRpc,
    },
    now: systemClock,
  });
}

const broadcastEvent = (event: WalletEventMessage): void => {
  void runtime?.sendMessage?.(event).catch(() => undefined);
  void tabs
    ?.query({})
    .then((openTabs) => {
      for (const tab of openTabs) {
        if (typeof tab.id === "number") {
          void tabs.sendMessage(tab.id, event).catch(() => undefined);
        }
      }
    })
    .catch(() => undefined);
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
runtime?.onMessage.addListener((message, sender, sendResponse) => {
  requestApprovalSurface(extensionApi, approvalSurfacePreference, runtime.id, message, sender);
  void sessionReady
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
