/**
 * Typed extension message handling for the background service worker.
 */

import { DEFAULT_NETWORK } from "../starknet/networks";
import { activeAccountSecrets } from "../wallet/vault-service";
import { readCreateAccountInput } from "./account-creation-inputs";
import { runUnlockedNetworkMutation, runVaultCreationWithNetwork } from "./active-network-mutation";
import { handleAddChainOps } from "./add-chain-ops";
import { handleAllowanceOps } from "./allowance-ops";
import { handleApprovalDecision } from "./approval-decisions";
import { enrichApprovals } from "./approval-insights";
import { notifyApprovalsChanged } from "./approval-notifier";
import { handleChainOps } from "./chain-ops";
import { handleDeclareOps } from "./declare-ops";
import { handleDiscoveryOps } from "./discovery-ops";
import { readImportAccountInput } from "./import-inputs";
import { handleLedgerOps } from "./ledger-ops";
import { type MessageHandlerOptions, type RouterContext, routerContext } from "./message-context";
import {
  readAddAccountInput,
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
import { handleOnboardingOps } from "./onboarding-ops";
import { handleOriginOps } from "./origins-ops";
import { handlePreferenceOps } from "./preference-ops";
import { handleProviderOps } from "./provider-ops";
import {
  reconcileActiveAccount,
  reconcileUnlockedActiveAccount,
  selectActiveAccount,
  statusResponse,
  switchActiveNetwork,
} from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import {
  isClaimedSenderOrigin,
  isExtensionPageSender,
  parseGatedMessage,
  type RuntimeSender,
} from "./senders";
import { createUnlockSession } from "./session";
import { handleStrk20Ops } from "./strk20-ops";
import { handleStrk20WalletOps } from "./strk20-wallet-ops";
import { handleSwapOps } from "./swap-ops";
import { handleTokenOps } from "./token-ops";
import { unlockFailureError } from "./unlock-errors";
import { handleWalletOps, type WalletOpsDeps } from "./wallet-ops";
import type { WalletStatusReader } from "./wallet-reader";

type RouterHandler = (
  ctx: RouterContext,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse | null>;

const buildOpsDeps = (ctx: RouterContext): WalletOpsDeps => ({
  activeStateCoordinator: ctx.activeStateCoordinator,
  activity: ctx.activity,
  allowanceStore: ctx.allowanceStore,
  ledgerSignQueue: ctx.ledgerSignQueue,
  multisigStore: ctx.multisigStore,
  now: ctx.now,
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
  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runVaultCreationWithNetwork(
      ctx.session,
      ctx.preferencesStore,
      networkId,
      () => ctx.wallet.createAccount(input),
    );
    ctx.session.unlock(input.vaultPassphrase);
    return { account, ok: true };
  });
};

const handleAddAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.addAccount") {
    return null;
  }
  const input = readAddAccountInput(message);
  if (!input) {
    return { error: "invalid add account request" };
  }
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runUnlockedNetworkMutation(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      (vaultPassphrase) =>
        ctx.wallet.addDerivedAccount({ networkId: input.networkId, vaultPassphrase }),
    );
    return account ? { account, ok: true } : { error: "wallet locked" };
  });
};

const handleImportAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.importAccount") {
    return null;
  }
  const input = readImportAccountInput(message);
  if (!input) {
    return { error: "invalid import account request" };
  }
  const importRawKeyAccount = ctx.wallet.importRawKeyAccount;
  if (!importRawKeyAccount) {
    return { error: "wallet unavailable" };
  }
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runUnlockedNetworkMutation(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      (vaultPassphrase) => importRawKeyAccount({ ...input, vaultPassphrase }),
    );
    return account ? { account, ok: true } : { error: "wallet locked" };
  });
};

const handleGenerateMnemonic: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.generateMnemonic") {
    return null;
  }
  return readTypeOnlyInput(message, "wallet.generateMnemonic")
    ? { mnemonic: await ctx.wallet.generateMnemonic(), ok: true }
    : { error: "invalid generate mnemonic request" };
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
  if (input.silent) {
    return { accounts: [], ok: true };
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
  if (!input) {
    return { error: "invalid active account request" };
  }
  const account = await selectActiveAccount(
    ctx.wallet,
    ctx.session,
    ctx.preferencesStore,
    input.accountId,
    ctx.activeStateCoordinator,
  );
  return account ? { account, ok: true } : { error: "wallet locked" };
};

const handleSetActiveNetwork: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.setActiveNetwork") {
    return null;
  }
  const input = readSetActiveNetworkInput(message);
  if (!input) {
    return { error: "invalid network request" };
  }
  await switchActiveNetwork(
    ctx.wallet,
    ctx.session,
    ctx.preferencesStore,
    input.networkId,
    ctx.activeStateCoordinator,
  );
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
    return await ctx.activeStateCoordinator.run(async () => {
      await ctx.wallet.readVault(input.vaultPassphrase);
      await reconcileActiveAccount(ctx.wallet, ctx.preferencesStore, input.vaultPassphrase);
      ctx.session.unlock(input.vaultPassphrase);
      return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
    });
  } catch (error) {
    throw unlockFailureError(error);
  }
};

const handlePreferences: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.importPreferences") {
    return handlePreferenceOps(ctx.preferencesStore, messageType, message);
  }
  return ctx.activeStateCoordinator.run(async () => {
    const response = await handlePreferenceOps(ctx.preferencesStore, messageType, message);
    if (response && "preferences" in response) {
      await reconcileUnlockedActiveAccount(ctx.wallet, ctx.session, ctx.preferencesStore);
    }
    return response;
  });
};

// Ordered handlers own disjoint message types and return null otherwise.
const HANDLERS: readonly RouterHandler[] = [
  (ctx, messageType, message) => handleWalletOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleLedgerOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) =>
    handleSwapOps(
      {
        ...buildOpsDeps(ctx),
        swap: ctx.swap,
        swapPreparations: ctx.swapPreparations,
      },
      messageType,
      message,
    ),
  (ctx, messageType, message) => handleAllowanceOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleNftOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleMultisigOps(buildMultisigDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleMultisigTxOps(buildMultisigDeps(ctx), messageType, message),
  handlePreferences,
  (ctx, messageType, message, sender) => handleChainOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleProviderOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleDiscoveryOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleAddChainOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleDeclareOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleStrk20Ops(ctx, messageType, message, sender),
  (ctx, messageType, message) =>
    handleStrk20WalletOps(
      {
        ...buildOpsDeps(ctx),
        strk20Preparations: ctx.strk20Preparations,
      },
      messageType,
      message,
    ),
  (ctx, messageType, message) => handleOriginOps(ctx, messageType, message),
  (ctx, messageType, message) => handleTokenOps(ctx, messageType, message),
  handleCreateAccount,
  handleAddAccount,
  handleImportAccount,
  (ctx, messageType, message) => handleApprovalDecision(ctx, messageType, message),
  handleGenerateMnemonic,
  (ctx, messageType, message) => handleOnboardingOps(ctx.wallet, messageType, message),
  handleRevealSecrets,
  handleGrantOrigin,
  handleGetGrantedAccounts,
  handlePendingApprovals,
  handleRequestAccounts,
  handleSetActiveAccount,
  handleSetActiveNetwork,
  handleSignHash,
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
 * Creates the trusted background runtime message dispatcher.
 */
export const createMessageHandler = (
  wallet: WalletStatusReader,
  extensionId: string,
  options: MessageHandlerOptions = {},
) => {
  // Resolve the session before the queue so the queue can read its generation.
  const session = options.session ?? createUnlockSession();
  const ctx = routerContext(wallet, extensionId, options, session);
  return async (message: unknown, sender?: RuntimeSender): Promise<RuntimeResponse> => {
    try {
      return await handleRuntimeMessage(ctx, message, sender);
    } catch (error) {
      return runtimeErrorResponse(error, isExtensionPageSender(sender, extensionId));
    }
  };
};
