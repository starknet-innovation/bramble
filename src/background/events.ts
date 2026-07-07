/**
 * Pure decisions about which wallet events to broadcast after the background
 * handles a runtime mutation. Broadcasts carry no addresses; content scripts
 * re-query what their origin may see before telling any page.
 */
import type { WalletEventMessage } from "../provider/events";
import { isRecord } from "../shared/json";
import { isStarknetNetworkId, STARKNET_NETWORKS } from "../starknet/networks";

const accountsChanged: WalletEventMessage = { event: "accountsChanged", type: "wallet.event" };
const approvalsChanged: WalletEventMessage = { event: "approvalsChanged", type: "wallet.event" };

const networkChanged = (chainId: string): WalletEventMessage => ({
  chainId,
  event: "networkChanged",
  type: "wallet.event",
});

const networkChangedForId = (networkId: unknown): WalletEventMessage | null =>
  isStarknetNetworkId(networkId) ? networkChanged(STARKNET_NETWORKS[networkId].chainId) : null;

const withNetwork = (network: WalletEventMessage | null): readonly WalletEventMessage[] =>
  network ? [accountsChanged, network] : [accountsChanged];

/**
 * Decides which wallet events to broadcast for a handled runtime message and
 * its response. Error responses never broadcast.
 */
export const walletEventBroadcasts = (
  message: unknown,
  response: unknown,
): readonly WalletEventMessage[] => {
  if (!isRecord(message) || typeof message.type !== "string") {
    return [];
  }
  if (!isRecord(response) || typeof response.error === "string") {
    return [];
  }

  if (message.type === "wallet.createAccount") {
    const account = isRecord(response.account) ? response.account : null;
    return withNetwork(account ? networkChangedForId(account.networkId) : null);
  }
  if (message.type === "wallet.approveOrigin") {
    return [accountsChanged, approvalsChanged];
  }
  if (message.type === "wallet.denyOrigin") {
    return [approvalsChanged];
  }
  if (message.type === "wallet.requestAccounts") {
    return response.ok === false && isRecord(response.pending) ? [approvalsChanged] : [];
  }
  if (message.type === "wallet.setActiveAccount") {
    return [accountsChanged];
  }
  if (message.type === "wallet.setActiveNetwork") {
    return withNetwork(networkChangedForId(response.networkId));
  }
  if (message.type === "wallet.switchChain") {
    return withNetwork(
      typeof response.chainId === "string" ? networkChanged(response.chainId) : null,
    );
  }
  if (message.type === "wallet.lock" || message.type === "wallet.unlock") {
    return [accountsChanged];
  }
  return [];
};
