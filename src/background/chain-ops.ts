/**
 * Provider chain and typed-data signing operations dispatched from the
 * background message handler: SNIP-12 signing, chain-id reads, and dapp chain
 * switches. Split from messages.ts to keep it within the size budget.
 */
import {
  networkIdForChainId,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "../starknet/networks";
import { typedDataHash } from "../starknet/typed-data";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { notifyApprovalsChanged } from "./approval-notifier";
import type { ApprovalQueue } from "./approvals";
import {
  readOriginRequestInput,
  readSignTypedDataInput,
  readSwitchChainInput,
} from "./message-inputs";
import { switchActiveNetwork } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import type { SignatureWaiters } from "./signature-waiters";

/**
 * Dependencies for the provider chain and signing operations.
 */
export type ChainOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly preferencesStore: WalletPreferencesStore;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
};

/**
 * Builds a short, user-facing summary of a SNIP-12 typed-data request for the
 * approval card (primary type and, when present, the domain name).
 */
const describeTypedData = (typedData: unknown): string => {
  if (typeof typedData !== "object" || typedData === null) {
    return "typed data";
  }
  const record = typedData as Record<string, unknown>;
  const primaryType = typeof record["primaryType"] === "string" ? record["primaryType"] : "message";
  const domain =
    typeof record["domain"] === "object" && record["domain"] !== null
      ? (record["domain"] as Record<string, unknown>)
      : {};
  const name = typeof domain["name"] === "string" ? domain["name"] : "";
  return name ? `${primaryType} · ${name}` : primaryType;
};

/**
 * Signs a user-approved SNIP-12 request: re-resolves the active account for the
 * origin (a locked wallet or revoked grant fails safely) and returns the
 * signature, or an error response the caller can deliver back to the dapp.
 */
export const executeSignApproval = async (
  deps: Pick<ChainOpsDeps, "preferencesStore" | "session" | "wallet">,
  input: { readonly origin: string; readonly typedData: unknown },
): Promise<RuntimeResponse> => {
  const { preferencesStore, session, wallet } = deps;
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
  const { approvals, extensionId, preferencesStore, session, waiters, wallet } = deps;

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
    try {
      typedDataHash(input.typedData, account.address);
    } catch {
      return { error: "invalid typed data" };
    }
    // Never auto-sign: queue a per-request approval and hold this response until
    // the user decides in the side panel. The signature is computed and returned
    // through this same channel on approval, so it reaches only the requesting
    // origin and tab.
    const approval = approvals.requestSignTypedData({
      origin: input.origin,
      summary: describeTypedData(input.typedData),
      typedData: input.typedData,
    });
    notifyApprovalsChanged();
    return waiters.register(approval.id);
  }

  if (messageType === "wallet.getChainId") {
    // The content bridge sends { origin, type }; chain id is public data so the
    // origin is not gated, but the message must still be well-formed.
    if (!readOriginRequestInput(message, "wallet.getChainId")) {
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
    // Only an origin that already holds a connection grant may ask to switch the
    // network — and even then it may only ask: the switch never happens without
    // an explicit user approval. A locked or unconnected site is refused.
    if (granted.length === 0) {
      return { error: "origin not connected" };
    }
    const approval = approvals.requestSwitchChain({
      chainId: STARKNET_NETWORKS[networkId].chainId,
      networkId,
      origin: input.origin,
      summary: `Switch network to ${STARKNET_NETWORKS[networkId].name}`,
    });
    notifyApprovalsChanged();
    return waiters.register(approval.id);
  }

  return null;
};

/**
 * Applies a user-approved chain switch: sets the active network, keeps the
 * origin's grant on the new network, and returns the new chain id for the dapp.
 */
export const executeSwitchChainApproval = async (
  deps: Pick<ChainOpsDeps, "preferencesStore" | "session" | "wallet">,
  input: { readonly networkId: StarknetNetworkId; readonly origin: string },
): Promise<RuntimeResponse> => {
  const { preferencesStore, session, wallet } = deps;
  const passphrase = session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const account = await switchActiveNetwork(wallet, session, preferencesStore, input.networkId);
  const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
  if (account && !granted.some((item) => item.id === account.id)) {
    await wallet.grantOrigin({
      accountId: account.id,
      origin: input.origin,
      vaultPassphrase: passphrase,
    });
  }
  return { chainId: STARKNET_NETWORKS[input.networkId].chainId, ok: true };
};
