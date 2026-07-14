/**
 * MV3 background entrypoint. All privileged wallet state stays behind this worker.
 */
import * as krustyModule from "/vendor/krusty-kms/pkg/krusty_kms_wasm.js";
import { createKrustyKms } from "../crypto/krusty";
import type { WalletEventMessage } from "../provider/events";
import { createOriginGuard } from "../security/blocklist";
import { createPhishingFeed } from "../security/phishing-feed";
import { MULTISIG_CLASS_ARTIFACT } from "../starknet/multisig-deploy";
import { createPriceService, unavailablePriceService } from "../starknet/prices";
import { createActivityLog, systemClock } from "../storage/activity-store";
import { createAllowanceStore } from "../storage/allowance-store";
import {
  createBrowserLocalStore,
  createBrowserSessionStore,
  hardenSessionAccess,
} from "../storage/browser-storage";
import { createEncryptedStore, type EncryptedStore } from "../storage/encrypted-store";
import { createMultisigStore } from "../storage/multisig-store";
import { createOriginHistoryStore } from "../storage/origin-history";
import { createPreferencesStore } from "../storage/preferences-store";
import { createWalletVaultService, VAULT_STORE_KEY } from "../wallet/vault-service";
import { setApprovalNotifier } from "./approval-notifier";
import { requestApprovalSurface } from "./approval-surface";
import { createApprovalQueue } from "./approvals";
import { walletEventBroadcasts } from "./events";
import { createMessageHandler } from "./messages";
import { defaultRuntimeRpc } from "./runtime-rpc";
import type { RuntimeSender } from "./senders";
import { createUnlockSession, type UnlockSessionStore } from "./session";

type RuntimeApi = {
  readonly getURL?: (path: string) => string;
  readonly id: string;
  readonly onInstalled: {
    readonly addListener: (listener: () => void) => void;
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

type TabsApi = {
  readonly query: (
    queryInfo: Record<string, never>,
  ) => Promise<readonly { readonly id?: number }[]>;
  readonly sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: {
    readonly runtime?: RuntimeApi;
    readonly sidePanel?: {
      readonly open: (options: { readonly tabId: number }) => Promise<void>;
      readonly setPanelBehavior: (behavior: {
        readonly openPanelOnActionClick: boolean;
      }) => Promise<void>;
    };
    readonly tabs?: TabsApi;
  };
};

const SESSION_STORE_KEY = "mc-wallet:session";

const extensionApi = (globalThis as ExtensionGlobal).chrome;
const runtime = extensionApi?.runtime;
const tabs = extensionApi?.tabs;
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
const vaultStore: EncryptedStore | null = (() => {
  try {
    return createEncryptedStore(createBrowserLocalStore(), VAULT_STORE_KEY);
  } catch {
    return null;
  }
})();
const session = createUnlockSession(undefined, undefined, sessionStore, () =>
  vaultStore?.clearKeys(),
);
const sessionReady = session.restore().catch(() => undefined);
// Restrict the in-memory session area (which mirrors the unlock passphrase
// across worker restarts) to trusted extension contexts, so content scripts
// and web pages can never read it.
void hardenSessionAccess().catch(() => undefined);
const wallet = vaultStore
  ? Promise.resolve()
      .then(() =>
        createWalletVaultService({
          encryptedStore: vaultStore,
          kms: createKrustyKms(krustyModule),
        }),
      )
      .catch(() => null)
  : Promise.resolve(null);
const preferences = Promise.resolve()
  .then(() => createPreferencesStore({ store: createBrowserLocalStore() }))
  .catch(() => null);
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
const handleMessage = createMessageHandler(
  {
    async addDerivedAccount(input) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.addDerivedAccount(input);
    },
    async createAccount(input) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.createAccount(input);
    },
    async ensureNetworkAccount(input) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.ensureNetworkAccount(input);
    },
    async getGrantedAccounts(origin, vaultPassphrase) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.getGrantedAccounts(origin, vaultPassphrase);
    },
    async generateMnemonic() {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.generateMnemonic();
    },
    async grantOrigin(input) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.grantOrigin(input);
    },
    async readVault(vaultPassphrase) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.readVault(vaultPassphrase);
    },
    async revokeOrigin(input) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.revokeOrigin(input);
    },
    async setActiveAccount(input) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.setActiveAccount(input);
    },
    async signHash(input) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.signHash(input);
    },
    async status() {
      const service = await wallet;
      if (!service) {
        return {
          accountCount: 0,
          activeAccountId: null,
          hasVault: false,
          locked: true,
          ready: false,
        };
      }
      return service.status();
    },
  },
  runtime?.id ?? "",
  {
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
        return store.importPreferences(input);
      },
      async read() {
        const store = await preferences;
        if (!store) {
          throw new Error("preferences unavailable");
        }
        return store.read();
      },
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
        return store.setDisplay(input);
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
      async setStrk20ProverUrl(input) {
        const store = await preferences;
        if (!store) {
          throw new Error("preferences unavailable");
        }
        return store.setStrk20ProverUrl(input);
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
    runtimeRpc: defaultRuntimeRpc,
    originGuard,
    ...(activityLog ? { activity: activityLog } : {}),
    ...(originHistory ? { originHistory } : {}),
    prices: priceService,
    ...(allowanceLog ? { allowanceStore: allowanceLog } : {}),
    ...(multisigLog ? { multisigStore: multisigLog } : {}),
    loadMultisigClass,
  },
);

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

runtime?.onInstalled.addListener(() => undefined);
void extensionApi?.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => undefined);
runtime?.onMessage.addListener((message, sender, sendResponse) => {
  requestApprovalSurface(extensionApi?.sidePanel, runtime.id, message, sender);
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
