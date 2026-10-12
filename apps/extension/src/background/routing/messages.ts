/** Typed extension message handling for the background service worker. */
import { WalletError } from "@bramble/core/errors";
import { activeAccountSecrets } from "@bramble/vault/service";
import { handleWalletOps, type WalletOpsDeps } from "../accounts/wallet-ops";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { handleApprovalDecision } from "../approvals/approval-decisions";
import { enrichApprovals } from "../approvals/approval-insights";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import { handleLedgerOps } from "../ledger/ledger-ops";
import { handleMultisigCoordinationOps } from "../multisig/multisig-coordination-ops";
import { handleMultisigOps, type MultisigOpsDeps } from "../multisig/multisig-ops";
import { handleMultisigTxOps } from "../multisig/multisig-tx-ops";
import { handleOnboardingOps } from "../onboarding/onboarding-ops";
import { handleAllowanceOps } from "../portfolio/allowance-ops";
import { handleDiscoveryOps } from "../portfolio/discovery-ops";
import { handleNftOps } from "../portfolio/nft-ops";
import { handleTokenOps } from "../portfolio/token-ops";
import { handleStrk20Ops } from "../privacy/strk20-ops";
import { handleStrk20WalletOps } from "../privacy/strk20-wallet-ops";
import { handleAddChainOps } from "../provider/add-chain-ops";
import { handleProviderOps } from "../provider/provider-ops";
import {
  reconcileActiveAccount,
  reconcileUnlockedActiveAccount,
  selectActiveAccount,
  statusResponse,
  switchActiveNetwork,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, createUnlockSession } from "../runtime/session";
import { handleOriginOps } from "../settings/origins-ops";
import { handlePreferenceOps } from "../settings/preference-ops";
import { supportDiagnosticsResponse } from "../support/diagnostics";
import { handleChainOps } from "../transactions/chain-ops";
import { handleDeclareOps } from "../transactions/declare-ops";
import { handleSwapOps } from "../transactions/swap-ops";
import { handleAccountCreationOps, type RouterHandler } from "./account-creation-handlers";
import { type MessageHandlerOptions, type RouterContext, routerContext } from "./message-context";
import {
  readGetGrantedAccountsInput,
  readRequestAccountsInput,
  readRevealSecretsInput,
  readSetActiveAccountInput,
  readSetActiveNetworkInput,
  readTypeOnlyInput,
  readUnlockInput,
} from "./message-inputs";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  isExtensionPageSender,
  parseGatedMessage,
  type RuntimeSender,
} from "./senders";
import { unlockFailureError } from "./unlock-errors";

const buildOpsDeps = (ctx: RouterContext): WalletOpsDeps => ({
  activeStateCoordinator: ctx.activeStateCoordinator,
  activity: ctx.activity,
  allowanceStore: ctx.allowanceStore,
  balanceSnapshots: ctx.balanceSnapshots,
  ledgerSignQueue: ctx.ledgerSignQueue,
  multisigStore: ctx.multisigStore,
  ...(ctx.nftSnapshots ? { nftSnapshots: ctx.nftSnapshots } : {}),
  now: ctx.now,
  preferencesStore: ctx.preferencesStore,
  runtimeRpc: ctx.runtimeRpc,
  session: ctx.session,
  wallet: ctx.wallet,
});
const buildMultisigDeps = (ctx: RouterContext): MultisigOpsDeps => ({
  ...buildOpsDeps(ctx),
  multisigDeploymentReviews: ctx.multisigDeploymentReviews,
  multisigStore: ctx.multisigStore,
  nostrCoordinationStore: ctx.nostrCoordinationStore,
  ...(ctx.nostrRelayTransport ? { nostrRelayTransport: ctx.nostrRelayTransport } : {}),
  now: ctx.now,
});

const MULTISIG_ACTIVE_STATE_MESSAGES = new Set([
  "wallet.addMultisig",
  "wallet.deployArgentMultisig",
  "wallet.importArgentMultisigIntent",
  "wallet.importArgentMultisigSignature",
  "wallet.prepareArgentMultisigIntent",
  "wallet.removeArgentMultisigIntent",
  "wallet.removeMultisig",
  "wallet.reviewArgentMultisigDeployment",
  "wallet.signArgentMultisigIntent",
  "wallet.submitArgentMultisigIntent",
]);

const handleMultisig: RouterHandler = async (ctx, messageType, message) => {
  const handle = async (): Promise<RuntimeResponse | null> => {
    const deps = buildMultisigDeps(ctx);
    return (
      (await handleMultisigOps(deps, messageType, message)) ??
      (await handleMultisigTxOps(deps, messageType, message)) ??
      handleMultisigCoordinationOps(deps, messageType, message)
    );
  };
  return MULTISIG_ACTIVE_STATE_MESSAGES.has(messageType)
    ? ctx.activeStateCoordinator.run(handle)
    : handle();
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

const handleGetGrantedAccounts: RouterHandler = async (ctx, messageType, message, sender) => {
  if (messageType !== "wallet.getGrantedAccounts") {
    return null;
  }
  const input = readGetGrantedAccountsInput(message);
  if (!input) {
    return { error: "invalid granted accounts request" };
  }
  if (input.vaultPassphrase && !isExtensionPageSender(sender, ctx.extension)) {
    return { error: "privileged sender required" };
  }
  if (!isClaimedSenderOrigin(sender, ctx.extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  // A blocklisted origin must see no accounts even if it holds an old grant.
  if (ctx.guard.isBlocked(input.origin)) {
    return { accounts: [], ok: true };
  }
  // Peek, never renew: re-querying grants must not extend the unlock lifetime.
  const authorized = captureSessionAuthorization(ctx.session);
  const vaultPassphrase = input.vaultPassphrase ?? ctx.session.peekPassphrase();
  if (!vaultPassphrase) {
    // A passive dapp grant query returns the same empty result while locked as
    // it does while unlocked-but-unconnected. Extension pages that explicitly
    // supplied a passphrase still receive authentication failures below, but a
    // site cannot use `mc_accounts` as a lock-state oracle.
    return { accounts: [], ok: true };
  }
  const accounts = await ctx.wallet.getGrantedAccounts(input.origin, vaultPassphrase);
  if (!input.vaultPassphrase && !authorized.isCurrent()) return { accounts: [], ok: true };
  return { accounts, ok: true };
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
  if (!isClaimedSenderOrigin(sender, ctx.extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if (ctx.guard.isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  // Peek, never renew. `wallet_requestAccounts` with `silent_mode` is reachable
  // from any open page and answers without a prompt, so a site could otherwise
  // hold the wallet unlocked forever just by calling it on a timer.
  const passphrase = ctx.session.peekPassphrase();
  const authorized = captureSessionAuthorization(ctx.session);
  if (passphrase) {
    const accounts = await ctx.wallet.getGrantedAccounts(input.origin, passphrase);
    if (accounts.length > 0) {
      // Record the origin only once it is actually connecting, so the enricher
      // still reports "first time seen" for a new site's approval.
      await ctx.originHistory.record(input.origin);
    }
    // A lock that lands during the read falls through to what a locked wallet
    // answers, so the race is not a lock-state signal of its own (Sherlock 148).
    if (authorized.isCurrent() && accounts.length > 0) return { accounts, ok: true };
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

const handleStatus: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.status") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.status")) {
    return { error: "invalid status request" };
  }
  return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
};

const handleDiagnostics: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.diagnostics") return null;
  return readTypeOnlyInput(message, "wallet.diagnostics")
    ? supportDiagnosticsResponse(ctx.wallet, ctx.session, ctx.preferencesStore)
    : { error: "invalid diagnostics request" };
};

// `wallet.unlockUnverified` is the recovery screen's "Unlock anyway": it first
// accepts a vault the store cannot verify (the service drops every site
// connection and retained Ledger viewing key while doing so), then unlocks it
// exactly like `wallet.unlock`. The service refuses a vault that verifies, so
// this cannot be used to skip the freshness check on a healthy wallet.
const acceptUnverifiedVault = async (
  wallet: WalletStatusReader,
  vaultPassphrase: string,
): Promise<void> => {
  if (!wallet.recoverUnverifiedVault) {
    throw new WalletError("wallet unavailable");
  }
  await wallet.recoverUnverifiedVault(vaultPassphrase);
};

const handleUnlock: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.unlock" && messageType !== "wallet.unlockUnverified") {
    return null;
  }
  const input = readUnlockInput(message, messageType);
  if (!input) {
    return { error: "invalid unlock request" };
  }
  const generation = ctx.session.generation();
  try {
    return await ctx.activeStateCoordinator.run(async () => {
      if (ctx.session.generation() !== generation) {
        return { error: "wallet locked" };
      }
      if (messageType === "wallet.unlockUnverified") {
        await acceptUnverifiedVault(ctx.wallet, input.vaultPassphrase);
      }
      await ctx.wallet.readVault(input.vaultPassphrase);
      if (ctx.session.generation() !== generation) {
        return { error: "wallet locked" };
      }
      await reconcileActiveAccount(ctx.wallet, ctx.preferencesStore, input.vaultPassphrase);
      if (ctx.session.generation() !== generation) {
        return { error: "wallet locked" };
      }
      ctx.session.unlock(input.vaultPassphrase);
      return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
    });
  } catch (error) {
    throw unlockFailureError(error);
  }
};

const handlePreferences: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.importPreferences") {
    const response = await handlePreferenceOps(ctx.preferencesStore, messageType, message);
    if (messageType === "wallet.setNftIndexerUrl" && response && "preferences" in response) {
      await ctx.nftSnapshots?.clearAll().catch(() => undefined);
    }
    return response;
  }
  return ctx.activeStateCoordinator.run(async () => {
    const response = await handlePreferenceOps(ctx.preferencesStore, messageType, message);
    if (response && "preferences" in response) {
      await ctx.nftSnapshots?.clearAll().catch(() => undefined);
      await reconcileUnlockedActiveAccount(ctx.wallet, ctx.session, ctx.preferencesStore);
    }
    return response;
  });
};

// Ordered handlers own disjoint message types and return null otherwise.
//
// Deliberately absent (MCW-V09-124): there is no `wallet.signHash` message. An
// arbitrary field element signed with the account key, under no approval and no
// domain separation, is a signing oracle; hash signing is reachable only from
// inside the background through ./account-hash-signer.ts, which binds each hash
// to a reviewed operation. `wallet.grantOrigin` is absent for the same reason —
// origin grants are issued by ./approval-decisions.ts after a user decision, so
// no message may mint one directly. Do not re-add either as a message type.
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
  handleMultisig,
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
        prices: ctx.prices,
        strk20Jobs: ctx.strk20Jobs,
        strk20Preparations: ctx.strk20Preparations,
      },
      messageType,
      message,
    ),
  (ctx, messageType, message) => handleOriginOps(ctx, messageType, message),
  (ctx, messageType, message) => handleTokenOps(ctx, messageType, message),
  handleAccountCreationOps,
  (ctx, messageType, message) => handleApprovalDecision(ctx, messageType, message),
  handleGenerateMnemonic,
  (ctx, messageType, message) => handleOnboardingOps(ctx, messageType, message),
  handleRevealSecrets,
  handleGetGrantedAccounts,
  handleDiagnostics,
  handlePendingApprovals,
  handleRequestAccounts,
  handleSetActiveAccount,
  handleSetActiveNetwork,
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
  const gated = parseGatedMessage(message, sender, ctx.extension);
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

/** Creates the trusted background runtime message dispatcher. */
export const createMessageHandler = (
  wallet: WalletStatusReader,
  extension: ExtensionIdentity,
  options: MessageHandlerOptions = {},
) => {
  const session = options.session ?? createUnlockSession();
  const ctx = routerContext(wallet, extension, options, session);
  return async (message: unknown, sender?: RuntimeSender): Promise<RuntimeResponse> => {
    try {
      return await handleRuntimeMessage(ctx, message, sender);
    } catch (error) {
      return runtimeErrorResponse(error, isExtensionPageSender(sender, extension));
    }
  };
};
