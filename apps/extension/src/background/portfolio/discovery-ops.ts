/**
 * Read-only dapp discovery operations dispatched from the background message
 * handler: the supported JSON-RPC spec versions, the supported wallet-API
 * versions, and the counterfactual deployment data for a connected origin.
 * These never mutate wallet state and never prompt, so no approval is queued;
 * deployment data is still gated to an origin that holds a connection grant.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { normalizeWalletOrigin } from "@bramble/core/origin";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { accountDeployment } from "@bramble/starknet/deployment";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { API_VERSION_PATTERN } from "@bramble/wallet-protocol/results";
import { SUPPORTED_SPECS, SUPPORTED_WALLET_API } from "@bramble/wallet-protocol/versions";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";

/**
 * Re-exported from the single-source versions module so callers importing them
 * from the discovery layer still resolve the one canonical definition.
 */
export { SUPPORTED_SPECS, SUPPORTED_WALLET_API };

/**
 * Dependencies shared by the read-only discovery operation handlers.
 */
export type DiscoveryOpsDeps = {
  readonly extension: ExtensionIdentity;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  /**
   * Non-renewing session view: discovery is read-only traffic a page can poll,
   * so it observes the unlock window and never extends it.
   */
  readonly session: PassiveUnlockSession;
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

const handleSupportedVersions: DiscoveryOpsHandler = async (deps, messageType, message, sender) => {
  const input = readDiscoveryInput(message, messageType);
  if (!input) {
    return { error: "invalid discovery request" };
  }
  // Same perimeter as every other dapp surface: a blocked origin learns
  // nothing from this wallet, not even its supported versions (Sherlock 165).
  if (!isClaimedSenderOrigin(sender, deps.extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  if (!apiVersionSupported(input.apiVersion)) {
    return { error: "unsupported api version" };
  }
  const versions = messageType === "wallet.supportedSpecs" ? SUPPORTED_SPECS : SUPPORTED_WALLET_API;
  return { ok: true, versions: [...versions] };
};

const handleDeploymentData: DiscoveryOpsHandler = async (deps, _messageType, message, sender) => {
  const { extension, preferencesStore, runtimeRpc, session, wallet } = deps;
  const input = readDiscoveryInput(message, "wallet.deploymentData");
  if (!input) {
    return { error: "invalid deployment data request" };
  }
  if (!isClaimedSenderOrigin(sender, extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  if (!apiVersionSupported(input.apiVersion)) {
    return { error: "unsupported api version" };
  }
  const authorized = captureSessionAuthorization(session);
  const passphrase = session.peekPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  const network = STARKNET_NETWORKS[account.networkId];
  const deployed = await runtimeRpc.getDeploymentStatus({
    accountAddress: account.address,
    rpcUrls: networkRpcUrls(network, preferences),
  });
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  if (deployed) {
    return { error: "account already deployed" };
  }
  try {
    const deployment = accountDeployment(account);
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
  const handler = Object.hasOwn(DISCOVERY_OPS_HANDLERS, messageType)
    ? DISCOVERY_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, messageType, message, sender) : null;
};
