/**
 * Provider chain and typed-data signing operations dispatched from the
 * background message handler: SNIP-12 signing, chain-id reads, and dapp chain
 * switches. Split from messages.ts to keep it within the size budget.
 */
import { networkIdForChainId, STARKNET_NETWORKS } from "../starknet/networks";
import { typedDataHash } from "../starknet/typed-data";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { readSignTypedDataInput, readSwitchChainInput, readTypeOnlyInput } from "./message-inputs";
import { switchActiveNetwork } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";

/**
 * Dependencies for the provider chain and signing operations.
 */
export type ChainOpsDeps = {
  readonly extensionId: string;
  readonly preferencesStore: WalletPreferencesStore;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Handles provider chain and typed-data signing messages; returns null for
 * other message types.
 */
export const handleChainOps = async (
  deps: ChainOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  const { extensionId, preferencesStore, session, wallet } = deps;

  if (messageType === "wallet.signTypedData") {
    const input = readSignTypedDataInput(message);
    const passphrase = session.getPassphrase();
    if (!input) {
      return { error: "invalid sign typed data request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    const preferences = await preferencesStore.read();
    const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
    const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
    if (!account) {
      return { error: "origin not connected" };
    }
    let messageHash: string;
    try {
      messageHash = typedDataHash(input.typedData, account.address);
    } catch {
      return { error: "invalid typed data" };
    }
    const signature = await wallet.signHash({
      accountId: account.id,
      messageHash,
      vaultPassphrase: passphrase,
    });
    return { ok: true, signature };
  }

  if (messageType === "wallet.getChainId") {
    if (!readTypeOnlyInput(message, "wallet.getChainId")) {
      return { error: "invalid chain id request" };
    }
    const preferences = await preferencesStore.read();
    return { chainId: STARKNET_NETWORKS[preferences.activeNetworkId].chainId, ok: true };
  }

  if (messageType === "wallet.switchChain") {
    const input = readSwitchChainInput(message);
    if (!input) {
      return { error: "invalid switch chain request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    const networkId = networkIdForChainId(input.chainId);
    if (!networkId) {
      return { error: "unsupported chain" };
    }
    const passphrase = session.getPassphrase();
    const granted = passphrase ? await wallet.getGrantedAccounts(input.origin, passphrase) : [];
    const account = await switchActiveNetwork(wallet, session, preferencesStore, networkId);
    if (
      passphrase &&
      account &&
      granted.length > 0 &&
      !granted.some((item) => item.id === account.id)
    ) {
      await wallet.grantOrigin({
        accountId: account.id,
        origin: input.origin,
        vaultPassphrase: passphrase,
      });
    }
    return { chainId: STARKNET_NETWORKS[networkId].chainId, ok: true };
  }

  return null;
};
