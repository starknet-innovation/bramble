/**
 * Read-only dapp discovery operations dispatched from the background message
 * handler: the supported JSON-RPC spec versions, the supported wallet-API
 * versions, and the counterfactual deployment data for a connected origin.
 * These never mutate wallet state and never prompt, so no approval is queued;
 * deployment data is still gated to an origin that holds a connection grant.
 */

import { API_VERSION_PATTERN } from "../provider/bridge-results";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { normalizeWalletOrigin } from "../shared/origin";
import { SUPPORTED_SPECS, SUPPORTED_WALLET_API } from "../shared/versions";
import { ozAccountDeployment } from "../starknet/deployment";
import { STARKNET_NETWORKS } from "../starknet/networks";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Re-exported from the single-source versions module so callers importing them
 * from the discovery layer still resolve the one canonical definition.
 */
export { SUPPORTED_SPECS, SUPPORTED_WALLET_API };

/**
 * Dependencies shared by the read-only discovery operation handlers.
 */
export type DiscoveryOpsDeps = {
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

type DiscoveryInput = { readonly apiVersion?: string; readonly origin: string };

// Parses a discovery message (`{ origin, type }`, optionally `{ apiVersion }`)
// from content-script traffic, normalizing the origin and rejecting a malformed
// api version so it never reaches version negotiation.
const readDiscoveryInput = (message: unknown, type: string): DiscoveryInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["apiVersion", "origin", "type"]) ||
    message["type"] !== type ||
    (message["apiVersion"] !== undefined &&
      (typeof message["apiVersion"] !== "string" ||
        !API_VERSION_PATTERN.test(message["apiVersion"])))
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  if (!origin) {
    return null;
  }
  return {
    origin,
    ...(message["apiVersion"] === undefined ? {} : { apiVersion: message["apiVersion"] as string }),
  };
};

// Returns true when an api version is absent or one this wallet supports.
const apiVersionSupported = (apiVersion: string | undefined): boolean =>
  apiVersion === undefined || SUPPORTED_WALLET_API.includes(apiVersion);

type DiscoveryOpsHandler = (
  deps: DiscoveryOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse>;

const handleSupportedVersions: DiscoveryOpsHandler = async (_deps, messageType, message) => {
  const input = readDiscoveryInput(message, messageType);
  if (!input) {
    return { error: "invalid discovery request" };
  }
  if (!apiVersionSupported(input.apiVersion)) {
    return { error: "unsupported api version" };
  }
  const versions = messageType === "wallet.supportedSpecs" ? SUPPORTED_SPECS : SUPPORTED_WALLET_API;
  return { ok: true, versions: [...versions] };
};

const handleDeploymentData: DiscoveryOpsHandler = async (deps, _messageType, message, sender) => {
  const { extensionId, preferencesStore, runtimeRpc, session, wallet } = deps;
  const input = readDiscoveryInput(message, "wallet.deploymentData");
  if (!input) {
    return { error: "invalid deployment data request" };
  }
  if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  if (!apiVersionSupported(input.apiVersion)) {
    return { error: "unsupported api version" };
  }
  const passphrase = session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
  const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  const network = STARKNET_NETWORKS[account.networkId];
  const deployed = await runtimeRpc.getDeploymentStatus({
    accountAddress: account.address,
    rpcUrls: networkRpcUrls(network, preferences),
  });
  if (deployed) {
    return { error: "account already deployed" };
  }
  try {
    const deployment = ozAccountDeployment(account);
    return {
      deployment: {
        address: deployment.contractAddress,
        calldata: [...deployment.constructorCalldata],
        classHash: deployment.classHash,
        salt: deployment.addressSalt,
        version: 1,
      },
      ok: true,
    };
  } catch {
    return { error: "deployment data not available" };
  }
};

/**
 * Dispatch table for read-only discovery messages, keyed by message type. The
 * two version queries share one handler that reads the requested type.
 */
const DISCOVERY_OPS_HANDLERS: Readonly<Record<string, DiscoveryOpsHandler>> = {
  "wallet.deploymentData": handleDeploymentData,
  "wallet.supportedSpecs": handleSupportedVersions,
  "wallet.supportedWalletApi": handleSupportedVersions,
};

/**
 * Handles read-only discovery messages; returns null for other message types.
 * Origin gating on `wallet.deploymentData` mirrors the other provider methods:
 * a locked, blocked, or unconnected origin is refused.
 */
export const handleDiscoveryOps = async (
  deps: DiscoveryOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  const handler = DISCOVERY_OPS_HANDLERS[messageType];
  return handler ? handler(deps, messageType, message, sender) : null;
};
