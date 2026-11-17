/**
 * Message handler wired to a wallet service that is entirely unavailable.
 * Used by tests that exercise dispatch-layer behavior (privilege gating,
 * message-shape rejection) without any vault behind it.
 */
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { chromiumExtension } from "./background-wallet-stub";

const unavailableVaultStatus = () => ({
  accountCount: 0,
  activeAccountId: null,
  hasVault: false,
  locked: true,
  ready: false,
});

/**
 * Dispatcher whose every wallet operation throws "wallet unavailable"; the
 * extension id is "bramble-test".
 */
export const handleMessage = createMessageHandler(
  {
    async addDerivedAccount() {
      throw new Error("wallet unavailable");
    },
    async createAccount() {
      throw new Error("wallet unavailable");
    },
    async ensureNetworkAccount() {
      throw new Error("wallet unavailable");
    },
    async importRawKeyAccount() {
      throw new Error("wallet unavailable");
    },
    async getGrantedAccounts() {
      throw new Error("wallet unavailable");
    },
    async generateMnemonic() {
      throw new Error("wallet unavailable");
    },
    async grantOrigin() {
      throw new Error("wallet unavailable");
    },
    async readVault() {
      throw new Error("wallet unavailable");
    },
    async setActiveAccount() {
      throw new Error("wallet unavailable");
    },
    async signHash() {
      throw new Error("wallet unavailable");
    },
    async status() {
      return unavailableVaultStatus();
    },
  },
  chromiumExtension("bramble-test"),
);
