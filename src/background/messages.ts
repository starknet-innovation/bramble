/**
 * Typed extension message handling for the background service worker.
 */

import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import { type SwapService, unavailableSwapService } from "../starknet/avnu";
import { DEFAULT_NETWORK } from "../starknet/networks";
import { type PriceService, unavailablePriceService } from "../starknet/prices";
import { type ActivityLog, memoryActivityLog } from "../storage/activity-store";
import { type AllowanceStore, memoryAllowanceStore } from "../storage/allowance-store";
import { type MultisigStore, memoryMultisigStore } from "../storage/multisig-store";
import { memoryOriginHistory, type OriginHistoryStore } from "../storage/origin-history";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { activeAccountSecrets } from "../wallet/vault-service";
import { handleAddChainOps } from "./add-chain-ops";
import { handleAllowanceOps } from "./allowance-ops";
import { handleApprovalDecision } from "./approval-decisions";
import { enrichApprovals } from "./approval-insights";
import { notifyApprovalsChanged } from "./approval-notifier";
import { type ApprovalQueue, createApprovalQueue } from "./approvals";
import { handleChainOps } from "./chain-ops";
import { handleDeclareOps } from "./declare-ops";
import { handleDiscoveryOps } from "./discovery-ops";
import { readImportAccountInput } from "./import-inputs";
import { handleLedgerOps } from "./ledger-ops";
import {
  createLedgerSignQueue,
  type LedgerSignQueue,
  type LedgerSignQueueTimeout,
} from "./ledger-sign-queue";
import {
  readAddAccountInput,
  readCreateAccountInput,
  readGetGrantedAccountsInput,
  readGrantOriginInput,
  readRequestAccountsInput,
  readRevealSecretsInput,
  readSetActiveAccountInput,
  readSetActiveNetworkInput,
  readSignHashInput,
  readTypeOnlyInput,
  readUnlockInput,
} from "./message-inputs";
import { handleMultisigOps, type MultisigOpsDeps } from "./multisig-ops";
import { handleMultisigTxOps } from "./multisig-tx-ops";
import { handleNftOps } from "./nft-ops";
import { handleOriginOps } from "./origins-ops";
import { handlePreferenceOps } from "./preference-ops";
import { handleProviderOps } from "./provider-ops";
import { defaultRuntimeRpc, type RuntimeRpc } from "./runtime-rpc";
import { statusResponse, switchActiveNetwork, unavailablePreferencesStore } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import {
  isClaimedSenderOrigin,
  isExtensionPageSender,
  parseGatedMessage,
  type RuntimeSender,
} from "./senders";
import { createUnlockSession, type UnlockSession } from "./session";
import { createSignatureWaiters, type SignatureWaiters } from "./signature-waiters";
import { handleStrk20Ops } from "./strk20-ops";
import { handleSwapOps } from "./swap-ops";
import { handleTokenOps } from "./token-ops";
import { unlockFailureError } from "./unlock-errors";
import { handleWalletOps, type WalletOpsDeps } from "./wallet-ops";

// Everything the runtime router hands to a sub-handler. One bag keeps the
// router body free of per-handler argument plumbing.
type RouterContext = {
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard: OriginGuard;
  readonly ledgerSignQueue: LedgerSignQueue;
  readonly loadMultisigClass: (() => Promise<unknown>) | undefined;
  readonly multisigStore: MultisigStore;
  readonly originHistory: OriginHistoryStore;
  readonly preferencesStore: WalletPreferencesStore;
  readonly prices: PriceService;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly swap: SwapService;
  readonly waiters: SignatureWaiters;
  readonly wallet: WalletStatusReader;
};

type RouterHandler = (
  ctx: RouterContext,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse | null>;

const buildOpsDeps = (ctx: RouterContext): WalletOpsDeps => ({
  activity: ctx.activity,
  allowanceStore: ctx.allowanceStore,
  ledgerSignQueue: ctx.ledgerSignQueue,
  preferencesStore: ctx.preferencesStore,
  runtimeRpc: ctx.runtimeRpc,
  session: ctx.session,
  wallet: ctx.wallet,
});

const buildMultisigDeps = (ctx: RouterContext): MultisigOpsDeps => ({
  ...buildOpsDeps(ctx),
  loadMultisigClass: ctx.loadMultisigClass,
  multisigStore: ctx.multisigStore,
});

const handleCreateAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.createAccount") {
    return null;
  }
  const input = readCreateAccountInput(message);
  if (!input) {
    return { error: "invalid create account request" };
  }
  const account = await ctx.wallet.createAccount(input);
  await ctx.preferencesStore.setActiveNetwork(input.networkId ?? DEFAULT_NETWORK.id);
  ctx.session.unlock(input.vaultPassphrase);
  return { account, ok: true };
};

const handleAddAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.addAccount") {
    return null;
  }
  const input = readAddAccountInput(message);
  const passphrase = ctx.session.getPassphrase();
  if (!input) {
    return { error: "invalid add account request" };
  }
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const account = await ctx.wallet.addDerivedAccount({
    networkId: input.networkId,
    vaultPassphrase: passphrase,
  });
  return { account, ok: true };
};

const handleImportAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.importAccount") {
    return null;
  }
  const input = readImportAccountInput(message);
  if (!input) {
    return { error: "invalid import account request" };
  }
  const passphrase = ctx.session.getPassphrase();
  if (!passphrase || !ctx.wallet.importRawKeyAccount) {
    return { error: passphrase ? "wallet unavailable" : "wallet locked" };
  }
  const account = await ctx.wallet.importRawKeyAccount({
    networkId: input.networkId,
    privateKey: input.privateKey,
    vaultPassphrase: passphrase,
  });
  return { account, ok: true };
};

const handleGenerateMnemonic: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.generateMnemonic") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.generateMnemonic")) {
    return { error: "invalid generate mnemonic request" };
  }
  return { mnemonic: await ctx.wallet.generateMnemonic(), ok: true };
};

const handleRevealSecrets: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.revealSecrets") {
    return null;
  }
  const input = readRevealSecretsInput(message);
  if (!input) {
    return { error: "invalid reveal request" };
  }
  const { mnemonic, privateKey } = activeAccountSecrets(
    await ctx.wallet.readVault(input.vaultPassphrase),
  );
  return { mnemonic, ok: true, privateKey };
};

const handleGrantOrigin: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.grantOrigin") {
    return null;
  }
  const input = readGrantOriginInput(message);
  if (!input) {
    return { error: "invalid grant origin request" };
  }
  return { accounts: await ctx.wallet.grantOrigin(input), ok: true };
};

const handleGetGrantedAccounts: RouterHandler = async (ctx, messageType, message, sender) => {
  if (messageType !== "wallet.getGrantedAccounts") {
    return null;
  }
  const input = readGetGrantedAccountsInput(message);
  if (!input) {
    return { error: "invalid granted accounts request" };
  }
  if (input.vaultPassphrase && !isExtensionPageSender(sender, ctx.extensionId)) {
    return { error: "privileged sender required" };
  }
  if (!isClaimedSenderOrigin(sender, ctx.extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  // A blocklisted origin must see no accounts even if it holds an old grant.
  if (ctx.guard.isBlocked(input.origin)) {
    return { accounts: [], ok: true };
  }
  // Peek, never renew: re-querying grants must not extend the unlock lifetime.
  const vaultPassphrase = input.vaultPassphrase ?? ctx.session.peekPassphrase();
  if (!vaultPassphrase) {
    return { error: "wallet locked" };
  }
  return {
    accounts: await ctx.wallet.getGrantedAccounts(input.origin, vaultPassphrase),
    ok: true,
  };
};

const handlePendingApprovals: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.pendingApprovals") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.pendingApprovals")) {
    return { error: "invalid pending approvals request" };
  }
  return {
    ok: true,
    pending: await enrichApprovals(ctx.approvals.list(), ctx.originHistory, ctx.guard),
  };
};

const handleRequestAccounts: RouterHandler = async (ctx, messageType, message, sender) => {
  if (messageType !== "wallet.requestAccounts") {
    return null;
  }
  const input = readRequestAccountsInput(message);
  if (!input) {
    return { error: "invalid request accounts request" };
  }
  if (!isClaimedSenderOrigin(sender, ctx.extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if (ctx.guard.isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  const passphrase = ctx.session.getPassphrase();
  if (passphrase) {
    const accounts = await ctx.wallet.getGrantedAccounts(input.origin, passphrase);
    if (accounts.length > 0) {
      // Record the origin only once it is actually connecting, so the enricher
      // still reports "first time seen" for a new site's approval.
      await ctx.originHistory.record(input.origin);
      return { accounts, ok: true };
    }
  }
  // Queue a connection approval and hold the response until the user approves.
  const approval = ctx.approvals.request(input.origin);
  notifyApprovalsChanged();
  return ctx.waiters.register(approval.id);
};

const handleSetActiveAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.setActiveAccount") {
    return null;
  }
  const input = readSetActiveAccountInput(message);
  const passphrase = ctx.session.getPassphrase();
  if (!input) {
    return { error: "invalid active account request" };
  }
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  return {
    account: await ctx.wallet.setActiveAccount({ ...input, vaultPassphrase: passphrase }),
    ok: true,
  };
};

const handleSetActiveNetwork: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.setActiveNetwork") {
    return null;
  }
  const input = readSetActiveNetworkInput(message);
  if (!input) {
    return { error: "invalid network request" };
  }
  await switchActiveNetwork(ctx.wallet, ctx.session, ctx.preferencesStore, input.networkId);
  return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
};

const handleSignHash: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.signHash") {
    return null;
  }
  const input = readSignHashInput(message);
  if (!input) {
    return { error: "invalid sign hash request" };
  }
  return { ok: true, signature: await ctx.wallet.signHash(input) };
};

const handleLock: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.lock") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.lock")) {
    return { error: "invalid lock request" };
  }
  // Revoke in-flight device signs before clearing the session so a parked Ledger
  // sign can't be completed and broadcast after the lock (see LedgerSignQueue).
  ctx.ledgerSignQueue.rejectAll("wallet locked");
  ctx.session.lock();
  return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
};

const handleStatus: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.status") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.status")) {
    return { error: "invalid status request" };
  }
  return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
};

const handleUnlock: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.unlock") {
    return null;
  }
  const input = readUnlockInput(message);
  if (!input) {
    return { error: "invalid unlock request" };
  }
  try {
    await ctx.wallet.readVault(input.vaultPassphrase);
  } catch (error) {
    throw unlockFailureError(error);
  }
  ctx.session.unlock(input.vaultPassphrase);
  return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
};

// Ordered dispatch table: each entry returns a response for the message types
// it owns and null otherwise, and the router returns the first non-null result.
// Types are partitioned across handlers, so order is readability, not behavior.
const HANDLERS: readonly RouterHandler[] = [
  (ctx, messageType, message) => handleWalletOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleLedgerOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) =>
    handleSwapOps({ ...buildOpsDeps(ctx), swap: ctx.swap }, messageType, message),
  (ctx, messageType, message) => handleAllowanceOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleNftOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleMultisigOps(buildMultisigDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleMultisigTxOps(buildMultisigDeps(ctx), messageType, message),
  (ctx, messageType, message) => handlePreferenceOps(ctx.preferencesStore, messageType, message),
  (ctx, messageType, message, sender) => handleChainOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleProviderOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleDiscoveryOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleAddChainOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleDeclareOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleStrk20Ops(ctx, messageType, message, sender),
  (ctx, messageType, message) => handleOriginOps(ctx, messageType, message),
  (ctx, messageType, message) => handleTokenOps(ctx, messageType, message),
  handleCreateAccount,
  handleAddAccount,
  handleImportAccount,
  (ctx, messageType, message) => handleApprovalDecision(ctx, messageType, message),
  handleGenerateMnemonic,
  handleRevealSecrets,
  handleGrantOrigin,
  handleGetGrantedAccounts,
  handlePendingApprovals,
  handleRequestAccounts,
  handleSetActiveAccount,
  handleSetActiveNetwork,
  handleSignHash,
  handleLock,
  handleStatus,
  handleUnlock,
];

const firstNonNull = async (
  handlers: readonly RouterHandler[],
  ctx: RouterContext,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  for (const handler of handlers) {
    const response = await handler(ctx, messageType, message, sender);
    if (response) {
      return response;
    }
  }
  return null;
};

const handleRuntimeMessage = async (
  ctx: RouterContext,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse> => {
  const gated = parseGatedMessage(message, sender, ctx.extensionId);
  if ("error" in gated) {
    return gated;
  }
  const response = await firstNonNull(HANDLERS, ctx, gated.messageType, message, sender);
  return response ?? { error: "unsupported message" };
};

const runtimeErrorResponse = (
  error: unknown,
  revealError: boolean,
): { readonly error: string } => ({
  error: revealError && error instanceof Error ? error.message : "wallet request failed",
});

/**
 * Optional collaborators for {@link createMessageHandler}. Every field falls
 * back to an in-memory or unavailable default, so tests wire only what they
 * exercise — by name, never by position, so a transposed argument cannot
 * silently rewire an unrelated dependency.
 */
export type MessageHandlerOptions = {
  readonly activity?: ActivityLog;
  readonly allowanceStore?: AllowanceStore;
  readonly approvals?: ApprovalQueue;
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly loadMultisigClass?: () => Promise<unknown>;
  readonly multisigStore?: MultisigStore;
  readonly originGuard?: OriginGuard;
  readonly originHistory?: OriginHistoryStore;
  readonly preferencesStore?: WalletPreferencesStore;
  readonly prices?: PriceService;
  readonly runtimeRpc?: RuntimeRpc;
  readonly session?: UnlockSession;
  readonly swap?: SwapService;
};

// Abandon a parked Ledger sign after a generous injected window, so a missing
// panel cannot hang the dapp promise and the queue itself needs no `setTimeout`.
const LEDGER_SIGN_TIMEOUT: LedgerSignQueueTimeout = {
  ms: 300_000,
  schedule: (onElapsed, ms) => {
    const handle = setTimeout(onElapsed, ms);
    return () => clearTimeout(handle);
  },
};

/**
 * Creates the trusted background runtime message dispatcher.
 */
export const createMessageHandler = (
  wallet: WalletStatusReader,
  extensionId: string,
  options: MessageHandlerOptions = {},
) => {
  // Resolve the session before the queue so the queue can read its generation.
  const session = options.session ?? createUnlockSession();
  const ctx: RouterContext = {
    activity: options.activity ?? memoryActivityLog(),
    allowanceStore: options.allowanceStore ?? memoryAllowanceStore(),
    approvals: options.approvals ?? createApprovalQueue(),
    extensionId,
    guard: options.originGuard ?? DEFAULT_ORIGIN_GUARD,
    ledgerSignQueue:
      options.ledgerSignQueue ??
      createLedgerSignQueue(notifyApprovalsChanged, LEDGER_SIGN_TIMEOUT, () =>
        session.isUnlocked() ? session.generation() : null,
      ),
    loadMultisigClass: options.loadMultisigClass,
    multisigStore: options.multisigStore ?? memoryMultisigStore(),
    originHistory: options.originHistory ?? memoryOriginHistory(),
    preferencesStore: options.preferencesStore ?? unavailablePreferencesStore,
    prices: options.prices ?? unavailablePriceService,
    runtimeRpc: options.runtimeRpc ?? defaultRuntimeRpc,
    session,
    swap: options.swap ?? unavailableSwapService,
    waiters: createSignatureWaiters(),
    wallet,
  };
  return async (message: unknown, sender?: RuntimeSender): Promise<RuntimeResponse> => {
    try {
      return await handleRuntimeMessage(ctx, message, sender);
    } catch (error) {
      return runtimeErrorResponse(error, isExtensionPageSender(sender, extensionId));
    }
  };
};
