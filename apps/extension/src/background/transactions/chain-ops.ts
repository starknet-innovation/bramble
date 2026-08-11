/**
 * Provider chain and typed-data signing operations dispatched from the
 * background message handler: SNIP-12 signing, chain-id reads, and dapp chain
 * switches. Split from messages.ts to keep it within the size budget.
 */

import { walletErrorMessage } from "@mc-wallet/core/errors";
import {
  networkIdForChainId,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@mc-wallet/permissions/blocklist";
import { typedDataHash } from "@mc-wallet/starknet/typed-data";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import { accountHashSigner } from "../ledger/account-hash-signer";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue } from "../approvals/approvals";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";

import {
  readOriginRequestInput,
  readSignTypedDataInput,
  readSwitchChainInput,
} from "../routing/message-inputs";
import {
  type ActiveStateCoordinator,
  runActiveStateMutation,
  switchActiveNetwork,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "../routing/senders";
import type { UnlockSession, PassiveUnlockSession } from "../runtime/session";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { requireApprovalAdmission } from "../approvals/approval-limits";


/**
 * Dependencies for the provider chain and signing operations.
 */
export type ChainOpsDeps = {
  readonly activeStateCoordinator?: ActiveStateCoordinator;
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial
   * test stubs stay valid; a Ledger typed-data sign with no queue fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  /**
   * Non-renewing session view: every handler here is reachable from a page on
   * a cadence the user does not control, so a passphrase read must observe the
   * unlock window and never extend it.
   */
  readonly session: PassiveUnlockSession;
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
  deps: Pick<ChainOpsDeps, "ledgerSignQueue" | "preferencesStore" | "session" | "wallet">,
  input: {
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly typedData: unknown;
  },
): Promise<RuntimeResponse> => {
  const { preferencesStore, session, wallet } = deps;
  const passphrase = session.peekPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  if (input.context && preferences.activeNetworkId !== input.context.networkId) {
    return { error: "approval context changed" };
  }
  const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
  const account = input.context
    ? granted.find(
        (stored) =>
          stored.id === input.context?.accountId &&
          stored.networkId === input.context.networkId &&
          stored.networkId === preferences.activeNetworkId,
      )
    : granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    return { error: "origin not connected" };
  }
  let messageHash: string;
  try {
    messageHash = typedDataHash(input.typedData, account.address);
  } catch {
    return { error: "invalid typed data" };
  }
  // A keyless Ledger account signs typed data on the device (verified against
  // publicKeyX) instead of the vault; accountHashSigner makes the same choice as
  // every other submitting path. A device rejection/timeout/verify-failure, or a
  // Ledger account with no queue wired, throws a WalletError from the sign path:
  // catch it and return `{ error }` (mirroring invoke/declare) so the applier
  // settles the held dapp request with the real reason instead of leaving it to
  // hang on an unhandled throw. Fails closed — no signature returned on error.
  try {
    const signature = await accountHashSigner(deps, account, passphrase)(messageHash);
    return { ok: true, signature };
  } catch (error) {
    return { error: walletErrorMessage(error, "sign typed data request failed") };
  }
};

type ChainOpsHandler = (
  deps: ChainOpsDeps,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse>;

const handleSignTypedData: ChainOpsHandler = async (deps, message, sender) => {
  const { approvals, extensionId, preferencesStore, session, waiters, wallet } = deps;
  const input = readSignTypedDataInput(message);
  if (!input) {
    return { error: "invalid sign typed data request" };
  }
  if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  // A blocklisted origin gets no signing prompt even if it still holds an old
  // connection grant — the phishing feed is the defense for the post-grant
  // case. Mirror the sibling dapp surfaces (provider-ops, declare, strk20).
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  // Refuse a flooding origin BEFORE the expensive work, not after it. Hashing a
  // maximum-size SNIP-12 document is hundreds of milliseconds of Pedersen in the
  // service worker that also serves the panel, and reading the grants decrypts
  // the vault — paying both for a request the queue cap will refuse anyway is
  // how a per-origin cap that bounds memory leaves CPU unbounded.
  requireApprovalAdmission(approvals, input.origin);
  // Read the session only after the message is well-formed and its origin is
  // both claimed truthfully and unblocked: the background must validate type,
  // origin, and capability before it acts on a message at all.
  const passphrase = session.peekPassphrase();
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
    context: await createApprovalContext(account, { typedData: input.typedData }),
    origin: input.origin,
    summary: describeTypedData(input.typedData),
    typedData: input.typedData,
  });
  notifyApprovalsChanged();
  return waiters.register(approval.id);
};

const handleGetChainId: ChainOpsHandler = async (deps, message) => {
  // The content bridge sends { origin, type }; chain id is public data so the
  // origin is not gated, but the message must still be well-formed.
  if (!readOriginRequestInput(message, "wallet.getChainId")) {
    return { error: "invalid chain id request" };
  }
  const preferences = await deps.preferencesStore.read();
  return { chainId: STARKNET_NETWORKS[preferences.activeNetworkId].chainId, ok: true };
};

const handleSwitchChain: ChainOpsHandler = async (deps, message, sender) => {
  const { approvals, extensionId, session, waiters, wallet } = deps;
  const input = readSwitchChainInput(message);
  if (!input) {
    return { error: "invalid switch chain request" };
  }
  if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  // Fail closed on a blocklisted origin before surfacing a switch prompt, even
  // with an existing grant — same perimeter as the other dapp surfaces.
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  const networkId = networkIdForChainId(input.chainId);
  if (!networkId) {
    return { error: "unsupported chain" };
  }
  const passphrase = session.peekPassphrase();
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
};

/**
 * Dispatch table for provider chain and signing messages, keyed by message
 * type. Each branch is a self-contained handler, leaving the router a lookup.
 */
const CHAIN_OPS_HANDLERS: Readonly<Record<string, ChainOpsHandler>> = {
  "wallet.getChainId": handleGetChainId,
  "wallet.signTypedData": handleSignTypedData,
  "wallet.switchChain": handleSwitchChain,
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
  const handler = CHAIN_OPS_HANDLERS[messageType];
  return handler ? handler(deps, message, sender) : null;
};

/**
 * Applies a user-approved chain switch: sets the active network, keeps the
 * origin's grant on the new network, and returns the new chain id for the dapp.
 * Refuses with `origin not connected` when the origin is not connected at
 * approval time, so an approved card can never reconnect a disconnected site.
 */
export const executeSwitchChainApproval = async (
  deps: Pick<ChainOpsDeps, "activeStateCoordinator" | "preferencesStore" | "wallet"> & {
    /**
     * The full session: applying the approval switches the active network, and
     * that cross-store mutation locks its own generation when it cannot be
     * completed. The grant re-check below still only observes the session.
     */
    readonly session: UnlockSession;
  },
  input: { readonly networkId: StarknetNetworkId; readonly origin: string },
): Promise<RuntimeResponse> => {
  const { preferencesStore, session, wallet } = deps;
  return runActiveStateMutation(deps.activeStateCoordinator, async () => {
    const passphrase = session.peekPassphrase();
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    // A switch-chain approval carries no account context, so the shared claim
    // validator skips it and this is the only place the grant is re-checked.
    // Read it BEFORE switching: the switch re-selects the active account, and the
    // auto-grant below would otherwise hand the origin a fresh account — silently
    // reconnecting a site the user disconnected by switching accounts, with no
    // connect prompt. A revoked or disconnected origin is refused instead.
    const connected = await wallet.getGrantedAccounts(input.origin, passphrase);
    if (connected.length === 0) {
      return { error: "origin not connected" };
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
  });
};
