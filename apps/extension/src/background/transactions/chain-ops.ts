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
import type { RelaySignatureLog } from "@bramble/transactions/relay-signatures";
import { networkIdForChainId, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { withApprovalReservation } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { PendingApproval } from "../approvals/approval-snapshot";
import type { ApprovalQueue } from "../approvals/approvals";
import { promptReconnectForStaleGrant } from "../approvals/reconnect-prompt";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { grantedDappAccounts, isGrantedMultisig } from "../provider/dapp-account";
import { queuedMultisigSignBlock, signMultisigIfGranted } from "../provider/multisig-dapp-sign";
import type { MultisigOriginGrantStore } from "../provider/multisig-grants";
import {
  readOriginRequestInput,
  type readSignTypedDataInput,
  readSwitchChainInput,
} from "../routing/message-inputs";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import {
  type ActiveStateCoordinator,
  networkRpcUrls,
  vaultAccountAddresses,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";
import { reviewOutsideExecution } from "./outside-execution-review";
import { recordRelaySignature } from "./relay-record";
import { resolveSignGrant } from "./sign-grant";
import { admitSignTypedData } from "./sign-typed-data-admission";
import { withTrustedRecipients } from "./trusted-recipients";
import { describeTypedData } from "./typed-data-summary";

/**
 * Dependencies for the provider chain and signing operations.
 */
export type ChainOpsDeps = {
  readonly activeStateCoordinator?: ActiveStateCoordinator;
  /**
   * Activity log, read for the recipients this wallet paid: the OutsideExecution
   * review refuses their lookalikes as the invoke route does (audit 163).
   */
  readonly activity: Pick<ActivityLog, "list">;
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
  readonly multisigGrants?: MultisigOriginGrantStore;
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
 * Signs a user-approved SNIP-12 request: re-resolves the active account for the
 * origin (a locked wallet or revoked grant fails safely) and returns the
 * signature, or an error response the caller can deliver back to the dapp.
 */
export const executeSignApproval = async (
  deps: Pick<
    ChainOpsDeps,
    | "activity"
    | "ledgerSignQueue"
    | "multisigGrants"
    | "multisigStore"
    | "preferencesStore"
    | "session"
    | "wallet"
  > & {
    readonly runtimeRpc?: Pick<RuntimeRpc, "getClassHashAt" | "multisig">;
    /** Signed OutsideExecution messages, recorded for Activity (issue 299). */
    readonly relaySignatures?: Pick<RelaySignatureLog, "record">;
    /** Overrides endpoint construction. Unset, each endpoint builds its own client. */
    readonly rpcProviderFor?: (nodeUrl: string) => RpcProvider;
  },
  input: {
    readonly context?: ApprovalContext;
    readonly origin: string;
    readonly typedData: unknown;
  },
): Promise<RuntimeResponse> => {
  const resolved = await resolveSignGrant(deps, input);
  if ("error" in resolved) return resolved;
  const { account, authorized, passphrase, preferences } = resolved;
  const { wallet } = deps;
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
  const multisigSigned = await signMultisigIfGranted(
    deps,
    account,
    input.typedData,
    passphrase,
    networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
    input.origin,
  );
  if (multisigSigned) return multisigSigned;
  if (isGrantedMultisig(account)) return { error: "Argent multisig not found" };
  // A keyless Ledger account signs typed data on the device (verified against
  // publicKeyX) instead of the vault; accountHashSigner makes the same choice as
  // every other submitting path. A device rejection/timeout/verify-failure, or a
  // Ledger account with no queue wired, throws a WalletError from the sign path:
  // catch it and return `{ error }` (mirroring invoke/declare) so the applier
  // settles the held dapp request with the real reason instead of leaving it to
  // hang on an unhandled throw. Fails closed — no signature returned on error.
  try {
    // OpenZeppelin is the only family whose encoding does not depend on a live
    // class. Every other family is checked before the key is used: a Braavos
    // account must run a known implementation with the wallet key as its first
    // stark signer and no active 2FA, and an unupgraded Argent 0.3.x account
    // cannot verify the 0.4 encoding this wallet emits.
    if (account.accountContractType !== "openzeppelin") {
      await withRpcFallback(
        networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
        (provider) => requireLiveAuthorizableClass(provider, account),
        deps.rpcProviderFor,
      );
    }
    const signature = await accountHashSigner(deps, account, passphrase)(messageHash);
    // A relay authorization the site can submit later is listed in Activity as
    // signed, never as a transaction. Recording can neither fail nor delay the
    // signature: it never rejects, and the reply does not wait for the write.
    void recordRelaySignature(deps.relaySignatures, {
      account,
      messageHash,
      origin: input.origin,
      typedData: input.typedData,
    });
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

/** Queues a typed-data approval under the origin's admission reservation. */
const queueSignTypedData = async (
  deps: ChainOpsDeps,
  input: NonNullable<ReturnType<typeof readSignTypedDataInput>>,
  summary: string,
  release: () => void,
): Promise<{ readonly approval: PendingApproval } | RuntimeResponse> => {
  const { approvals, preferencesStore, session, wallet } = deps;
  // Read the session only after the message is well-formed and its origin is
  // both claimed truthfully and unblocked: the background must validate type,
  // origin, and capability before it acts on a message at all. The
  // authorization is re-checked after every await, so a lock that lands
  // mid-request admits no card (Sherlock 166).
  const authorized = captureSessionAuthorization(session);
  const passphrase = session.peekPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  const granted = await grantedDappAccounts(deps, input.origin, passphrase);
  if (!authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const account = granted.find((stored) => stored.networkId === preferences.activeNetworkId);
  if (!account) {
    // Mirror provider-ops: a formerly granted origin gets a reconnect prompt
    // beside the refusal so its stuck signing spinner explains itself.
    promptReconnectForStaleGrant(approvals, granted, input.origin);
    return { error: "origin not connected" };
  }
  const blocked = await queuedMultisigSignBlock(deps, account, passphrase);
  if (blocked) return blocked;
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
  // accounts and the recipients this wallet paid (audit 163). A lookalike
  // recipient is queued with its flag, not refused, so the answer cannot reveal
  // the address book (Sherlock 140); the signing-time review refuses it.
  const review = reviewOutsideExecution(
    input.typedData,
    account,
    await withTrustedRecipients(deps, preferences, await vaultAccountAddresses(wallet, passphrase)),
    (await deps.allowanceStore?.list().catch(() => [])) ?? [],
    "queue",
  );
  if (review && "error" in review) {
    return review;
  }
  const context = await createApprovalContext(account, { typedData: input.typedData });
  if (!authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  // Never auto-sign: queue a per-request approval and hold this response until
  // the user decides in the side panel. The signature is computed and returned
  // through this same channel on approval, so it reaches only the requesting
  // origin and tab.
  const approval = approvals.requestSignTypedData({
    context,
    origin: input.origin,
    ...(review ? { review } : {}),
    summary,
    typedData: input.typedData,
  });
  release();
  notifyApprovalsChanged();
  return { approval };
};

const handleSignTypedData: ChainOpsHandler = async (deps, message, sender) => {
  const admitted = admitSignTypedData(deps, message, sender);
  if ("refusal" in admitted) {
    return admitted.refusal;
  }
  const { input } = admitted;
  // The reservation counts this request against the caps until it queues, so
  // concurrent requests cannot all pass admission before any of them does the
  // expensive work below (Sherlock 151).
  const queued = await withApprovalReservation(deps.approvals, input.origin, (release) =>
    queueSignTypedData(deps, input, describeTypedData(input.typedData), release),
  );
  // Registered once the reservation is released: the queued approval now
  // counts against the caps itself, and the held response settles only when
  // the user decides.
  return "approval" in queued ? deps.waiters.register(queued.approval.id) : queued;
};

const handleGetChainId: ChainOpsHandler = async (deps, message, sender) => {
  // The chain id is public data, but the origin is corroborated and checked
  // against the blocklist like every other dapp surface, so a blocked origin
  // learns nothing from this wallet, including which network is active
  // (Sherlock 165).
  const input = readOriginRequestInput(message, "wallet.getChainId");
  if (!input) {
    return { error: "invalid chain id request" };
  }
  if (!isClaimedSenderOrigin(sender, deps.extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  const preferences = await deps.preferencesStore.read();
  return { chainId: STARKNET_NETWORKS[preferences.activeNetworkId].chainId, ok: true };
};

const handleSwitchChain: ChainOpsHandler = async (deps, message, sender) => {
  const { approvals, extension, session, waiters } = deps;
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
  const authorized = captureSessionAuthorization(session);
  const passphrase = session.peekPassphrase();
  const granted = passphrase ? await grantedDappAccounts(deps, input.origin, passphrase) : [];
  const preferences = await deps.preferencesStore.read();
  // Only an origin that already holds a connection grant may ask to switch the
  // network — and even then it may only ask: the switch never happens without
  // an explicit user approval. A locked or unconnected site is refused, and a
  // lock that lands during either read counts as locked (Sherlock 166).
  if (granted.length === 0 || !authorized.isCurrent()) {
    return { error: "origin not connected" };
  }
  // Already there: nothing would change, so there is nothing to approve. Dapps
  // that switch before every transaction otherwise cost the user two prompts
  // (mc-wallet 1041). Only the active vault account on that network qualifies:
  // a presented multisig can hide a vault account the switch would reselect.
  if (
    preferences.activeNetworkId === networkId &&
    granted.every((account) => !isGrantedMultisig(account) && account.networkId === networkId)
  ) {
    return { chainId: STARKNET_NETWORKS[networkId].chainId, ok: true };
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
