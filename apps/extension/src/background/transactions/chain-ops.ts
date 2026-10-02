/**
 * Provider chain and typed-data signing operations dispatched from the
 * background message handler: SNIP-12 signing, chain-id reads, and dapp chain
 * switches. Split from messages.ts to keep it within the size budget.
 */

import { walletErrorMessage } from "@bramble/core/errors";
import type { MultisigStore } from "@bramble/multisig/repository";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { serializeAccountSignature } from "@bramble/starknet/account-contracts";
import { requireLiveAuthorizableClass } from "@bramble/starknet/deployment";
import { withRpcFallback } from "@bramble/starknet/provider";
import { typedDataHashForChain } from "@bramble/starknet/typed-data";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import { outsideExecutionDetails } from "@bramble/transactions/outside-execution-calls";
import type { Vault } from "@bramble/vault/schema";
import {
  networkIdForChainId,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { requireApprovalAdmission } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue } from "../approvals/approvals";
import { promptReconnectForStaleGrant } from "../approvals/reconnect-prompt";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import {
  readOriginRequestInput,
  readSignTypedDataInput,
  readSwitchChainInput,
} from "../routing/message-inputs";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import {
  type ActiveStateCoordinator,
  networkRpcUrls,
  runActiveStateMutation,
  switchActiveNetwork,
  vaultAccountAddresses,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import {
  captureSessionAuthorization,
  type PassiveUnlockSession,
  type UnlockSession,
} from "../runtime/session";
import { recordRelaySignature } from "./activity-recording";
import { reviewOutsideExecution } from "./outside-execution-review";
import { withTrustedRecipients } from "./trusted-recipients";

/**
 * Dependencies for the provider chain and signing operations.
 */
export type ChainOpsDeps = {
  readonly activeStateCoordinator?: ActiveStateCoordinator;
  /**
   * Activity log: read for the recipients this wallet paid (the OutsideExecution
   * review refuses their lookalikes as the invoke route does, audit 163), and
   * written to journal a locally signed SNIP-9 OutsideExecution for #299.
   */
  readonly activity: Pick<ActivityLog, "list" | "recordRelaySignature">;
  /**
   * Recorded allowance log, read for OutsideExecution risk flags only (an
   * unreadable log flags each call on its own amount). Optional so partial
   * test stubs stay valid.
   */
  readonly allowanceStore?: Pick<AllowanceStore, "list">;
  readonly approvals: ApprovalQueue;
  readonly extension: ExtensionIdentity;
  readonly guard?: OriginGuard;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial
   * test stubs stay valid; a Ledger typed-data sign with no queue fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  /** Watched shared accounts, trusted as the user's own; optional like the invoke route's. */
  readonly multisigStore?: Pick<MultisigStore, "listMultisigs">;
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
 * Journals a locally signed OutsideExecution (#299): records only when the
 * typed data is an OutsideExecution whose layout reads exactly, so a malformed
 * envelope plants nothing. The exact hash the signer committed to is the row's
 * identity, which lets a later scan link the relayed execution back to it.
 * Best effort: a storage failure must not fail the signer.
 */
const journalSignedOutsideExecution = async (
  activity: Pick<ActivityLog, "recordRelaySignature">,
  input: { readonly origin: string; readonly typedData: unknown },
  account: { readonly id: string; readonly networkId: StarknetNetworkId },
  messageHash: string,
): Promise<void> => {
  const detail = outsideExecutionDetails(input.typedData, messageHash);
  if (detail === null || detail === "malformed") {
    return;
  }
  await recordRelaySignature(activity, {
    accountId: account.id,
    hash: messageHash,
    networkId: account.networkId,
    snip9: { ...detail, dappOrigin: input.origin },
    summary: "Signed for relay",
  });
};

/**
 * Signs a user-approved SNIP-12 request: re-resolves the active account for the
 * origin (a locked wallet or revoked grant fails safely) and returns the
 * signature, or an error response the caller can deliver back to the dapp.
 */
export const executeSignApproval = async (
  deps: Pick<
    ChainOpsDeps,
    "activity" | "ledgerSignQueue" | "multisigStore" | "preferencesStore" | "session" | "wallet"
  > & {
    /** Overrides endpoint construction. Unset, each endpoint builds its own client. */
    readonly rpcProviderFor?: (nodeUrl: string) => RpcProvider;
  },
  input: {
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly typedData: unknown;
  },
): Promise<RuntimeResponse> => {
  const { preferencesStore, session, wallet } = deps;
  const passphrase = session.peekPassphrase();
  const authorized = captureSessionAuthorization(session);
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  if (input.context && preferences.activeNetworkId !== input.context.networkId) {
    return { error: "approval context changed" };
  }
  const granted = await wallet.getGrantedAccounts(input.origin, passphrase);
  if (!authorized.isCurrent()) return { error: "wallet locked" };
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
    messageHash = typedDataHashForChain(
      input.typedData,
      account.address,
      STARKNET_NETWORKS[account.networkId].chainId,
    );
  } catch {
    return { error: "invalid typed data" };
  }
  // An OutsideExecution's calls are re-reviewed against the trusted set as it
  // is now, not as it was when the card was queued (audit 144), including the
  // own accounts and paid recipients the invoke route trusts (audit 163).
  const trusted = await withTrustedRecipients(
    deps,
    preferences,
    await vaultAccountAddresses(wallet, passphrase),
  );
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const review = reviewOutsideExecution(input.typedData, account, trusted);
  if (review && "error" in review) {
    return review;
  }
  // A keyless Ledger account signs typed data on the device (verified against
  // publicKeyX) instead of the vault; accountHashSigner makes the same choice as
  // every other submitting path. A device rejection/timeout/verify-failure, or a
  // Ledger account with no queue wired, throws a WalletError from the sign path:
  // catch it and return `{ error }` (mirroring invoke/declare) so the applier
  // settles the held dapp request with the real reason instead of leaving it to
  // hang on an unhandled throw. Fails closed — no signature returned on error.
  try {
    // OpenZeppelin is the only family whose encoding does not depend on a live
    // class. Every other family is checked before the key is used: Braavos is
    // view-only, and an unupgraded Argent 0.3.x account cannot verify the 0.4
    // encoding this wallet emits.
    if (account.accountContractType !== "openzeppelin") {
      await withRpcFallback(
        networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
        (provider) => requireLiveAuthorizableClass(provider, account),
        deps.rpcProviderFor,
      );
    }
    const signature = await accountHashSigner(deps, account, passphrase)(messageHash);
    await journalSignedOutsideExecution(deps.activity, input, account, messageHash);
    return {
      ok: true,
      signature: serializeAccountSignature(account.accountContractType, signature),
    };
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
  const { approvals, extension, preferencesStore, session, waiters, wallet } = deps;
  const input = readSignTypedDataInput(message);
  if (!input) {
    return { error: "invalid sign typed data request" };
  }
  if (!isClaimedSenderOrigin(sender, extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  // A blocklisted origin gets no signing prompt even if it still holds an old
  // connection grant — the phishing feed is the defense for the post-grant
  // case. Mirror the sibling dapp surfaces (provider-ops, declare, strk20).
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  // Refuse a flooding origin BEFORE the expensive work, not after it. Hashing a
  // maximum-size SNIP-12 document can monopolize synchronous Pedersen work in
  // the service worker that also serves the panel, and reading the grants decrypts
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
    // Mirror provider-ops: a formerly granted origin gets a reconnect prompt
    // beside the refusal so its stuck signing spinner explains itself.
    promptReconnectForStaleGrant(approvals, granted, input.origin);
    return { error: "origin not connected" };
  }
  try {
    typedDataHashForChain(
      input.typedData,
      account.address,
      STARKNET_NETWORKS[account.networkId].chainId,
    );
  } catch {
    return { error: "invalid typed data" };
  }
  // An OutsideExecution authorizes calls the site can submit later without a
  // prompt, so it gets the invoke route's refusals and flags (audit 144),
  // including the standing-allowance totals the invoke route flags against.
  // The trusted set is the invoke route's: contacts plus the user's own
  // accounts and the recipients this wallet paid (audit 163).
  const review = reviewOutsideExecution(
    input.typedData,
    account,
    await withTrustedRecipients(deps, preferences, await vaultAccountAddresses(wallet, passphrase)),
    (await deps.allowanceStore?.list().catch(() => [])) ?? [],
  );
  if (review && "error" in review) {
    return review;
  }
  // Never auto-sign: queue a per-request approval and hold this response until
  // the user decides in the side panel. The signature is computed and returned
  // through this same channel on approval, so it reaches only the requesting
  // origin and tab.
  const approval = approvals.requestSignTypedData({
    context: await createApprovalContext(account, { typedData: input.typedData }),
    origin: input.origin,
    ...(review ? { review } : {}),
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
  const { approvals, extension, session, waiters, wallet } = deps;
  const input = readSwitchChainInput(message);
  if (!input) {
    return { error: "invalid switch chain request" };
  }
  if (!isClaimedSenderOrigin(sender, extension, input.origin)) {
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
  const handler = Object.hasOwn(CHAIN_OPS_HANDLERS, messageType)
    ? CHAIN_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message, sender) : null;
};

// The id of a vault account on `networkId` that `origin`'s stored grant
// covers, or undefined when the grant holds none there.
const heldAccountOn = (
  vault: Pick<Vault, "accounts" | "originGrants">,
  origin: string,
  networkId: StarknetNetworkId,
): string | undefined => {
  const grantIds = vault.originGrants.find((grant) => grant.origin === origin)?.accountIds ?? [];
  return vault.accounts.find(
    (account) => account.networkId === networkId && grantIds.includes(account.id),
  )?.id;
};

// Queues the reconnect prompt only when the account the switch landed on is
// really outside the origin's grant, never for a dapp still connected after it.
const promptWhenLandedOutsideGrant = async (
  deps: Pick<ChainOpsDeps, "wallet"> & { readonly approvals?: Pick<ApprovalQueue, "request"> },
  origin: string,
  passphrase: string,
  connected: readonly unknown[],
): Promise<void> => {
  if (!deps.approvals) {
    return;
  }
  const landed = await deps.wallet.getGrantedAccounts(origin, passphrase);
  if (landed.length === 0) {
    promptReconnectForStaleGrant(deps.approvals, connected, origin);
  }
};

/**
 * Applies a user-approved chain switch: sets the active network and returns the
 * new chain id for the dapp. Refuses with `origin not connected` when the origin
 * is not connected at approval time, so an approved card can never reconnect a
 * disconnected site. The switch never grants an account: the card names none,
 * so the origin keeps exactly the accounts it was granted. When it holds one on
 * the target network the switch lands there; when it holds none, the standard
 * reconnect (connect) prompt is queued instead, which names the account to share.
 */
export const executeSwitchChainApproval = async (
  deps: Pick<ChainOpsDeps, "activeStateCoordinator" | "preferencesStore" | "wallet"> & {
    /** Queue for the reconnect prompt; unset (partial test stubs) queues nothing. */
    readonly approvals?: Pick<ApprovalQueue, "request">;
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
    const authorized = captureSessionAuthorization(session);
    if (!passphrase || !authorized.isCurrent()) {
      return { error: "wallet locked" };
    }
    // A switch-chain approval carries no account context, so the shared claim
    // validator skips it and this is the only place the grant is re-checked.
    // Read it BEFORE switching: a revoked or disconnected origin is refused
    // rather than having the approved card switch the network on its behalf.
    const connected = await wallet.getGrantedAccounts(input.origin, passphrase);
    if (connected.length === 0) {
      return { error: "origin not connected" };
    }
    // `connected` is at most the active account (the page-visible view), so the
    // account the origin holds on the target network comes from its stored
    // grant, which keeps every account the user ever approved for it.
    const held = heldAccountOn(await wallet.readVault(passphrase), input.origin, input.networkId);
    if (!authorized.isCurrent()) {
      return { error: "wallet locked" };
    }
    await switchActiveNetwork(
      wallet,
      session,
      preferencesStore,
      input.networkId,
      undefined,
      held ? { preferredAccountId: held } : {},
    );
    if (!authorized.isCurrent()) {
      return { error: "wallet locked" };
    }
    // Exposure only narrows (audit 124): an account the user never connected
    // is not shared because they approved a network change.
    await promptWhenLandedOutsideGrant(deps, input.origin, passphrase, connected);
    return { chainId: STARKNET_NETWORKS[input.networkId].chainId, ok: true };
  });
};
