/**
 * Pure decisions about which wallet events to broadcast after the background
 * handles a runtime mutation. Broadcasts carry no addresses; content scripts
 * re-query what their origin may see before telling any page.
 */

import { isRecord } from "@mc-wallet/core/json";
import { isStarknetNetworkId, STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { WalletEventMessage } from "@mc-wallet/wallet-protocol/events";

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
 * Pure per-message-type broadcast factory. Receives the (already record-guarded,
 * non-error) response and returns the events that message type broadcasts.
 */
type BroadcastFactory = (response: Record<string, unknown>) => readonly WalletEventMessage[];

const createAccountBroadcast: BroadcastFactory = (response) => {
  const account = isRecord(response["account"]) ? response["account"] : null;
  return withNetwork(account ? networkChangedForId(account["networkId"]) : null);
};

// A switch-chain approval carries the new chain id, so dapps also see the
// network change; other approvals just refresh accounts + the queue.
const approveOriginBroadcast: BroadcastFactory = (response) =>
  typeof response["chainId"] === "string"
    ? [accountsChanged, approvalsChanged, networkChanged(response["chainId"])]
    : [accountsChanged, approvalsChanged];

const switchChainBroadcast: BroadcastFactory = (response) =>
  withNetwork(typeof response["chainId"] === "string" ? networkChanged(response["chainId"]) : null);

/**
 * Maps a handled message type to the events it broadcasts. Absent keys (and
 * error responses, handled by the caller) broadcast nothing.
 *
 * Every message type whose handler can change the vault's active account must
 * appear here: an origin only ever sees the active account, so changing it can
 * connect or disconnect a page, and a page told nothing keeps showing an
 * address the wallet will refuse to sign for. Adding, importing, or attaching
 * an account all select the new one, so they broadcast like a switch. The
 * events carry no addresses, so a message with key material in it (raw-key
 * import) still puts nothing sensitive on the wire —
 * `tests/background/background-events.test.ts` enforces both properties.
 */
const BROADCAST_FACTORIES: Readonly<Record<string, BroadcastFactory>> = {
  "wallet.addAccount": createAccountBroadcast,
  "wallet.addLedgerAccount": createAccountBroadcast,
  "wallet.approveOrigin": approveOriginBroadcast,
  "wallet.createAccount": createAccountBroadcast,
  "wallet.createLedgerVault": createAccountBroadcast,
  "wallet.denyOrigin": () => [approvalsChanged],
  "wallet.importAccount": createAccountBroadcast,
  "wallet.lock": () => [accountsChanged],
  "wallet.revokeOrigin": () => [accountsChanged],
  "wallet.setActiveAccount": () => [accountsChanged],
  "wallet.setActiveNetwork": (response) => withNetwork(networkChangedForId(response["networkId"])),
  "wallet.switchChain": switchChainBroadcast,
  "wallet.unlock": () => [accountsChanged],
};

/**
 * Decides which wallet events to broadcast for a handled runtime message and
 * its response. Error responses never broadcast.
 */
export const walletEventBroadcasts = (
  message: unknown,
  response: unknown,
): readonly WalletEventMessage[] => {
  if (!isRecord(message) || typeof message["type"] !== "string") {
    return [];
  }
  if (!isRecord(response) || typeof response["error"] === "string") {
    return [];
  }
  const factory = BROADCAST_FACTORIES[message["type"]];
  return factory ? factory(response) : [];
};
