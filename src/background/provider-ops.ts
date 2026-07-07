/**
 * dApp-facing provider operations dispatched from the background message
 * handler: origin permission queries and watch-asset requests. These reach the
 * background from the content bridge, so each verifies the claimed origin.
 */
import { STARKNET_NETWORKS } from "../starknet/networks";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import type { ApprovalQueue } from "./approvals";
import { readGetPermissionsInput, readWatchAssetInput } from "./provider-inputs";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import { watchAssetToken } from "./watch-asset";

/**
 * Dependencies shared by the dapp provider operation handlers.
 */
export type ProviderOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Handles dapp permission and watch-asset messages; returns null for others.
 */
export const handleProviderOps = async (
  deps: ProviderOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  const { approvals, extensionId, preferencesStore, runtimeRpc, session, wallet } = deps;

  if (messageType === "wallet.getPermissions") {
    const input = readGetPermissionsInput(message);
    if (!input) {
      return { error: "invalid permissions request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    const passphrase = session.getPassphrase();
    const granted = passphrase ? await wallet.getGrantedAccounts(input.origin, passphrase) : [];
    return { ok: true, permissions: granted.length > 0 ? ["accounts"] : [] };
  }

  if (messageType === "wallet.watchAsset") {
    const input = readWatchAssetInput(message);
    if (!input) {
      return { error: "invalid watch asset request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    const preferences = await preferencesStore.read();
    const networkId = preferences.activeNetworkId;
    const alreadyTracked = preferences.tokens.some(
      (token) => token.networkId === networkId && token.address === input.asset.address,
    );
    if (alreadyTracked) {
      return { ok: true, watched: true };
    }
    const metadata = await runtimeRpc
      .getTokenMetadata({
        address: input.asset.address,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], preferences),
      })
      .catch(() => null);
    const token = watchAssetToken(input.asset, metadata, networkId);
    if (!token) {
      return { error: "invalid watch asset metadata" };
    }
    return { ok: false, pending: approvals.requestWatchAsset({ origin: input.origin, token }) };
  }

  return null;
};
