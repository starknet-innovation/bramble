/**
 * Side-panel runtime wrapper that schedules confirmation polling after
 * successful wallet mutations, while leaving read-only messages untouched.
 */

const MUTATING_MESSAGES: ReadonlySet<string> = new Set([
  "wallet.addAccount",
  "wallet.addLedgerAccount",
  "wallet.addNft",
  "wallet.addToken",
  "wallet.approveOrigin",
  "wallet.createAccount",
  "wallet.createGroup",
  "wallet.createKeyVault",
  "wallet.createLedgerVault",
  "wallet.denyOrigin",
  "wallet.deployAccount",
  "wallet.deployArgentMultisig",
  "wallet.detectTokens",
  "wallet.importAccount",
  "wallet.importOwnAccounts",
  "wallet.importSeedAccounts",
  "wallet.importPreferences",
  "wallet.lock",
  "wallet.removeAddress",
  "wallet.removeGroup",
  "wallet.removeNft",
  "wallet.removeToken",
  "wallet.removeArgentMultisigIntent",
  "wallet.removeMultisig",
  "wallet.recoverAccounts",
  "wallet.renameGroup",
  "wallet.revokeAllowance",
  "wallet.revokeOrigin",
  "wallet.importArgentMultisigIntent",
  "wallet.importArgentMultisigSignature",
  "wallet.saveAddress",
  "wallet.setAccountInGroup",
  "wallet.setAccountLabel",
  "wallet.setActiveAccount",
  "wallet.setActiveNetwork",
  "wallet.setDisplay",
  "wallet.setExplorerFallback",
  "wallet.setGroupIcon",
  "wallet.setNftIndexerUrl",
  "wallet.setNostrRelayUrl",
  "wallet.setNftSpam",
  "wallet.setRpcOverride",
  "wallet.setStrk20NetworkConfig",
  "wallet.setTokenHidden",
  "wallet.transfer",
  "wallet.transferNft",
  "wallet.unlock",
  "wallet.prepareArgentMultisigIntent",
  "wallet.signArgentMultisigIntent",
  "wallet.submitArgentMultisigIntent",
  "wallet.swapExecute",
]);

/**
 * Refresh intensity after a successful runtime mutation.
 */
export type MutationRefresh = "burst" | "once";

// Only submissions whose chain state settles asynchronously earn repeated
// confirmation polls. Local preferences, labels, imports, and prepared intents
// repaint once instead of amplifying every change into six full hydrations.
const CHAIN_SETTLING_MESSAGES: ReadonlySet<string> = new Set([
  "wallet.deployAccount",
  "wallet.deployArgentMultisig",
  "wallet.revokeAllowance",
  "wallet.submitArgentMultisigIntent",
  "wallet.swapExecute",
  "wallet.transfer",
  "wallet.transferNft",
]);

type SendRuntime = {
  readonly sendMessage: (message: unknown) => Promise<unknown>;
};

/**
 * Wraps runtime messaging with a replaceable successful-mutation listener.
 */
export const createMutationRuntime = (runtime?: SendRuntime) => {
  let listener = (_refresh: MutationRefresh): void => undefined;
  return {
    async sendMessage(message: unknown): Promise<unknown> {
      const response = await runtime?.sendMessage(message);
      const type =
        typeof message === "object" && message !== null
          ? (message as Record<string, unknown>)["type"]
          : undefined;
      const failed =
        typeof response === "object" &&
        response !== null &&
        typeof (response as Record<string, unknown>)["error"] === "string";
      if (typeof type === "string" && MUTATING_MESSAGES.has(type) && !failed) {
        listener(CHAIN_SETTLING_MESSAGES.has(type) ? "burst" : "once");
      }
      return response;
    },
    setListener(next: (refresh: MutationRefresh) => void): void {
      listener = next;
    },
  };
};
