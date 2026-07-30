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
  "wallet.createLedgerVault",
  "wallet.confirmMultisigProposal",
  "wallet.declareMultisigClass",
  "wallet.denyOrigin",
  "wallet.deployAccount",
  "wallet.deployMultisig",
  "wallet.detectTokens",
  "wallet.importAccount",
  "wallet.importPreferences",
  "wallet.lock",
  "wallet.removeAddress",
  "wallet.removeGroup",
  "wallet.removeNft",
  "wallet.removeMultisig",
  "wallet.renameGroup",
  "wallet.revokeAllowance",
  "wallet.revokeOrigin",
  "wallet.revokeMultisigConfirmation",
  "wallet.saveAddress",
  "wallet.setAccountInGroup",
  "wallet.setAccountLabel",
  "wallet.setActiveAccount",
  "wallet.setActiveNetwork",
  "wallet.setDisplay",
  "wallet.setGroupIcon",
  "wallet.setNftIndexerUrl",
  "wallet.setNftSpam",
  "wallet.setRpcOverride",
  "wallet.setStrk20NetworkConfig",
  "wallet.setTokenHidden",
  "wallet.transfer",
  "wallet.transferNft",
  "wallet.unlock",
  "wallet.executeMultisigProposal",
  "wallet.proposeMultisigTx",
  "wallet.swapExecute",
  "wallet.trackMultisigProposal",
]);

type SendRuntime = {
  readonly sendMessage: (message: unknown) => Promise<unknown>;
};

/**
 * Wraps runtime messaging with a replaceable successful-mutation listener.
 */
export const createMutationRuntime = (runtime?: SendRuntime) => {
  let listener = (): void => undefined;
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
        listener();
      }
      return response;
    },
    setListener(next: () => void): void {
      listener = next;
    },
  };
};
