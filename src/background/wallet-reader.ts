/**
 * Adapts the privileged vault service (which may have failed to construct) into
 * the narrow {@link WalletStatusReader} the message dispatcher consumes. Every
 * method fails closed with "wallet unavailable" when the service is null, except
 * `status`, which reports an unavailable-but-defined status so the UI can render
 * a locked shell instead of erroring. Holds no state and no secrets; it only
 * forwards already-validated inputs to the service behind the vault boundary.
 */
import type { WalletVaultService } from "../wallet/vault-service";
import type { WalletStatusReader } from "./runtime-types";

/**
 * Wraps the (possibly null) vault service in the dispatcher's reader interface.
 */
export const createWalletReader = (
  service: Promise<WalletVaultService | null>,
): WalletStatusReader => {
  const required = async (): Promise<WalletVaultService> => {
    const resolved = await service;
    if (!resolved) {
      throw new Error("wallet unavailable");
    }
    return resolved;
  };
  return {
    async addDerivedAccount(input) {
      return (await required()).addDerivedAccount(input);
    },
    async addLedgerAccount(input) {
      return (await required()).addLedgerAccount(input);
    },
    async createAccount(input) {
      return (await required()).createAccount(input);
    },
    async createLedgerVault(input) {
      return (await required()).createLedgerVault(input);
    },
    async deriveLedgerAccounts(input) {
      return (await required()).deriveLedgerAccounts(input);
    },
    async deriveStrk20ViewingKey(input) {
      return (await required()).deriveStrk20ViewingKey(input);
    },
    async ensureNetworkAccount(input) {
      return (await required()).ensureNetworkAccount(input);
    },
    async generateMnemonic() {
      return (await required()).generateMnemonic();
    },
    async getGrantedAccounts(origin, vaultPassphrase) {
      return (await required()).getGrantedAccounts(origin, vaultPassphrase);
    },
    async grantOrigin(input) {
      return (await required()).grantOrigin(input);
    },
    async importRawKeyAccount(input) {
      return (await required()).importRawKeyAccount(input);
    },
    async previewAccount(input) {
      return (await required()).previewAccount(input);
    },
    async readVault(vaultPassphrase) {
      return (await required()).readVault(vaultPassphrase);
    },
    async revokeOrigin(input) {
      return (await required()).revokeOrigin(input);
    },
    async setActiveAccount(input) {
      return (await required()).setActiveAccount(input);
    },
    async signHash(input) {
      return (await required()).signHash(input);
    },
    async status() {
      const resolved = await service;
      return resolved
        ? resolved.status()
        : { accountCount: 0, activeAccountId: null, hasVault: false, locked: true, ready: false };
    },
  };
};
