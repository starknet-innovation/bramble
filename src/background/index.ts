/**
 * MV3 background entrypoint. All privileged wallet state stays behind this worker.
 */
import { loadKrustyKms } from "../crypto/krusty";
import { createBrowserLocalStore } from "../storage/browser-storage";
import { createEncryptedStore } from "../storage/encrypted-store";
import { createWalletVaultService, VAULT_STORE_KEY } from "../wallet/vault-service";
import { createApprovalQueue } from "./approvals";
import { createMessageHandler } from "./messages";
import type { RuntimeSender } from "./senders";
import { createUnlockSession } from "./session";

type RuntimeApi = {
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
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: {
    readonly runtime?: RuntimeApi;
  };
};

const runtime = (globalThis as ExtensionGlobal).chrome?.runtime;
const approvals = createApprovalQueue();
const session = createUnlockSession();
const wallet = loadKrustyKms()
  .then((kms) =>
    createWalletVaultService({
      encryptedStore: createEncryptedStore(createBrowserLocalStore(), VAULT_STORE_KEY),
      kms,
    }),
  )
  .catch(() => null);
const handleMessage = createMessageHandler(
  {
    async createAccount(input) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.createAccount(input);
    },
    async getGrantedAccounts(origin, vaultPassphrase) {
      const service = await wallet;
      if (!service) {
        throw new Error("wallet unavailable");
      }
      return service.getGrantedAccounts(origin, vaultPassphrase);
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
  session,
  approvals,
);

runtime?.onInstalled.addListener(() => undefined);
runtime?.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse, () => {
    sendResponse({ error: "wallet request failed" });
  });
  return true;
});
