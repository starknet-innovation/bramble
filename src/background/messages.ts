/**
 * Typed extension message handling for the background service worker.
 */

import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
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
import { handleMultisigOps } from "./multisig-ops";
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
  isPrivilegedMessage,
  isTrustedSender,
  type RuntimeSender,
} from "./senders";
import { createUnlockSession, type UnlockSession } from "./session";
import { createSignatureWaiters, type SignatureWaiters } from "./signature-waiters";
import { handleStrk20Ops } from "./strk20-ops";
import { handleTokenOps } from "./token-ops";
import { unlockFailureError } from "./unlock-errors";
import { handleWalletOps } from "./wallet-ops";

const readMessageType = (message: unknown): string | null => {
  if (typeof message !== "object" || message === null) {
    return null;
  }

  const descriptor = Object.getOwnPropertyDescriptor(message, "type");
  return descriptor?.enumerable === true &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
};

const handleRuntimeMessage = async (
  wallet: WalletStatusReader,
  extensionId: string,
  session: UnlockSession,
  approvals: ApprovalQueue,
  preferencesStore: WalletPreferencesStore,
  runtimeRpc: RuntimeRpc,
  activity: ActivityLog,
  originHistory: OriginHistoryStore,
  prices: PriceService,
  allowanceStore: AllowanceStore,
  waiters: SignatureWaiters,
  multisigStore: MultisigStore,
  loadMultisigClass: (() => Promise<unknown>) | undefined,
  guard: OriginGuard,
  message: unknown,
  sender?: RuntimeSender,
): Promise<RuntimeResponse> => {
  if (!isTrustedSender(sender, extensionId)) {
    return { error: "untrusted sender" };
  }

  const messageType = readMessageType(message);
  if (!messageType) {
    return { error: "unsupported message" };
  }

  if (isPrivilegedMessage(messageType) && !isExtensionPageSender(sender, extensionId)) {
    return { error: "privileged sender required" };
  }

  const opsDeps = { activity, allowanceStore, preferencesStore, runtimeRpc, session, wallet };

  const opsResponse = await handleWalletOps(opsDeps, messageType, message);
  if (opsResponse) {
    return opsResponse;
  }

  const allowanceResponse = await handleAllowanceOps(opsDeps, messageType, message);
  if (allowanceResponse) {
    return allowanceResponse;
  }

  const nftResponse = await handleNftOps(opsDeps, messageType, message);
  if (nftResponse) {
    return nftResponse;
  }

  const multisigDeps = { ...opsDeps, loadMultisigClass, multisigStore };
  const multisigResponse = await handleMultisigOps(multisigDeps, messageType, message);
  if (multisigResponse) {
    return multisigResponse;
  }

  const multisigTxResponse = await handleMultisigTxOps(multisigDeps, messageType, message);
  if (multisigTxResponse) {
    return multisigTxResponse;
  }

  const preferenceResponse = await handlePreferenceOps(preferencesStore, messageType, message);
  if (preferenceResponse) {
    return preferenceResponse;
  }

  const chainResponse = await handleChainOps(
    { approvals, extensionId, preferencesStore, session, waiters, wallet },
    messageType,
    message,
    sender,
  );
  if (chainResponse) {
    return chainResponse;
  }

  const providerOpsResponse = await handleProviderOps(
    { approvals, extensionId, guard, preferencesStore, runtimeRpc, session, waiters, wallet },
    messageType,
    message,
    sender,
  );
  if (providerOpsResponse) {
    return providerOpsResponse;
  }

  const discoveryResponse = await handleDiscoveryOps(
    { extensionId, guard, preferencesStore, runtimeRpc, session, wallet },
    messageType,
    message,
    sender,
  );
  if (discoveryResponse) {
    return discoveryResponse;
  }

  const addChainResponse = await handleAddChainOps(
    { approvals, extensionId, guard, preferencesStore, waiters },
    messageType,
    message,
    sender,
  );
  if (addChainResponse) {
    return addChainResponse;
  }

  const declareResponse = await handleDeclareOps(
    { approvals, extensionId, guard, preferencesStore, session, waiters, wallet },
    messageType,
    message,
    sender,
  );
  if (declareResponse) {
    return declareResponse;
  }

  const strk20Response = await handleStrk20Ops(
    {
      activity,
      approvals,
      extensionId,
      guard,
      preferencesStore,
      runtimeRpc,
      session,
      waiters,
      wallet,
    },
    messageType,
    message,
    sender,
  );
  if (strk20Response) {
    return strk20Response;
  }

  const originResponse = await handleOriginOps({ session, wallet }, messageType, message);
  if (originResponse) {
    return originResponse;
  }

  const tokenResponse = await handleTokenOps(
    { preferencesStore, prices, runtimeRpc, session, wallet },
    messageType,
    message,
  );
  if (tokenResponse) {
    return tokenResponse;
  }

  if (messageType === "wallet.createAccount") {
    const input = readCreateAccountInput(message);
    if (!input) {
      return { error: "invalid create account request" };
    }
    const account = await wallet.createAccount(input);
    await preferencesStore.setActiveNetwork(input.networkId ?? DEFAULT_NETWORK.id);
    session.unlock(input.vaultPassphrase);
    return { account, ok: true };
  }

  if (messageType === "wallet.addAccount") {
    const input = readAddAccountInput(message);
    const passphrase = session.getPassphrase();
    if (!input) {
      return { error: "invalid add account request" };
    }
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    const account = await wallet.addDerivedAccount({
      networkId: input.networkId,
      vaultPassphrase: passphrase,
    });
    return { account, ok: true };
  }

  const approvalDecision = await handleApprovalDecision(
    { activity, allowanceStore, approvals, preferencesStore, runtimeRpc, session, waiters, wallet },
    messageType,
    message,
  );
  if (approvalDecision) {
    return approvalDecision;
  }

  if (messageType === "wallet.generateMnemonic") {
    if (!readTypeOnlyInput(message, "wallet.generateMnemonic")) {
      return { error: "invalid generate mnemonic request" };
    }
    return { mnemonic: await wallet.generateMnemonic(), ok: true };
  }

  if (messageType === "wallet.revealSecrets") {
    const input = readRevealSecretsInput(message);
    if (!input) {
      return { error: "invalid reveal request" };
    }
    const { mnemonic, privateKey } = activeAccountSecrets(
      await wallet.readVault(input.vaultPassphrase),
    );
    return { mnemonic, ok: true, privateKey };
  }

  if (messageType === "wallet.grantOrigin") {
    const input = readGrantOriginInput(message);
    if (!input) {
      return { error: "invalid grant origin request" };
    }
    return { accounts: await wallet.grantOrigin(input), ok: true };
  }

  if (messageType === "wallet.getGrantedAccounts") {
    const input = readGetGrantedAccountsInput(message);
    if (!input) {
      return { error: "invalid granted accounts request" };
    }
    if (input.vaultPassphrase && !isExtensionPageSender(sender, extensionId)) {
      return { error: "privileged sender required" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    // A blocklisted origin must see no accounts even if it holds an old grant.
    if (guard.isBlocked(input.origin)) {
      return { accounts: [], ok: true };
    }
    // Peek, never renew: content scripts re-query grants automatically after
    // every broadcast, and a page can invoke this at will — neither is user
    // activity that should extend the unlock lifetime.
    const vaultPassphrase = input.vaultPassphrase ?? session.peekPassphrase();
    if (!vaultPassphrase) {
      return { error: "wallet locked" };
    }
    return {
      accounts: await wallet.getGrantedAccounts(input.origin, vaultPassphrase),
      ok: true,
    };
  }

  if (messageType === "wallet.pendingApprovals") {
    if (!readTypeOnlyInput(message, "wallet.pendingApprovals")) {
      return { error: "invalid pending approvals request" };
    }
    return { ok: true, pending: await enrichApprovals(approvals.list(), originHistory, guard) };
  }

  if (messageType === "wallet.requestAccounts") {
    const input = readRequestAccountsInput(message);
    if (!input) {
      return { error: "invalid request accounts request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    if (guard.isBlocked(input.origin)) {
      return { error: "origin blocked" };
    }
    const passphrase = session.getPassphrase();
    if (passphrase) {
      const accounts = await wallet.getGrantedAccounts(input.origin, passphrase);
      if (accounts.length > 0) {
        // Record the origin only once it is actually connecting; deferring the
        // first-seen write to the enricher keeps the "first time seen" insight
        // live for the pending approval a brand-new site produces.
        await originHistory.record(input.origin);
        return { accounts, ok: true };
      }
    }
    // Queue a connection approval and hold the response so the dapp's
    // requestAccounts resolves with the granted addresses after the user
    // approves — rather than rejecting and forcing a retry.
    const approval = approvals.request(input.origin);
    notifyApprovalsChanged();
    return waiters.register(approval.id);
  }

  if (messageType === "wallet.setActiveAccount") {
    const input = readSetActiveAccountInput(message);
    const passphrase = session.getPassphrase();
    if (!input) {
      return { error: "invalid active account request" };
    }
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    return {
      account: await wallet.setActiveAccount({ ...input, vaultPassphrase: passphrase }),
      ok: true,
    };
  }

  if (messageType === "wallet.setActiveNetwork") {
    const input = readSetActiveNetworkInput(message);
    if (!input) {
      return { error: "invalid network request" };
    }
    await switchActiveNetwork(wallet, session, preferencesStore, input.networkId);
    return statusResponse(wallet, session, preferencesStore);
  }

  if (messageType === "wallet.signHash") {
    const input = readSignHashInput(message);
    if (!input) {
      return { error: "invalid sign hash request" };
    }
    return { ok: true, signature: await wallet.signHash(input) };
  }

  if (messageType === "wallet.lock") {
    if (!readTypeOnlyInput(message, "wallet.lock")) {
      return { error: "invalid lock request" };
    }
    session.lock();
    return statusResponse(wallet, session, preferencesStore);
  }

  if (messageType === "wallet.status") {
    if (!readTypeOnlyInput(message, "wallet.status")) {
      return { error: "invalid status request" };
    }
    return statusResponse(wallet, session, preferencesStore);
  }

  if (messageType === "wallet.unlock") {
    const input = readUnlockInput(message);
    if (!input) {
      return { error: "invalid unlock request" };
    }
    try {
      await wallet.readVault(input.vaultPassphrase);
    } catch (error) {
      throw unlockFailureError(error);
    }
    session.unlock(input.vaultPassphrase);
    return statusResponse(wallet, session, preferencesStore);
  }

  return { error: "unsupported message" };
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
  readonly loadMultisigClass?: () => Promise<unknown>;
  readonly multisigStore?: MultisigStore;
  readonly originGuard?: OriginGuard;
  readonly originHistory?: OriginHistoryStore;
  readonly preferencesStore?: WalletPreferencesStore;
  readonly prices?: PriceService;
  readonly runtimeRpc?: RuntimeRpc;
  readonly session?: UnlockSession;
};

/**
 * Creates the trusted background runtime message dispatcher.
 */
export const createMessageHandler = (
  wallet: WalletStatusReader,
  extensionId: string,
  options: MessageHandlerOptions = {},
) => {
  const session = options.session ?? createUnlockSession();
  const approvals = options.approvals ?? createApprovalQueue();
  const preferencesStore = options.preferencesStore ?? unavailablePreferencesStore;
  const runtimeRpc = options.runtimeRpc ?? defaultRuntimeRpc;
  const activity = options.activity ?? memoryActivityLog();
  const originHistory = options.originHistory ?? memoryOriginHistory();
  const prices = options.prices ?? unavailablePriceService;
  const allowanceStore = options.allowanceStore ?? memoryAllowanceStore();
  const multisigStore = options.multisigStore ?? memoryMultisigStore();
  const guard = options.originGuard ?? DEFAULT_ORIGIN_GUARD;
  const waiters = createSignatureWaiters();
  return async (message: unknown, sender?: RuntimeSender): Promise<RuntimeResponse> => {
    try {
      return await handleRuntimeMessage(
        wallet,
        extensionId,
        session,
        approvals,
        preferencesStore,
        runtimeRpc,
        activity,
        originHistory,
        prices,
        allowanceStore,
        waiters,
        multisigStore,
        options.loadMultisigClass,
        guard,
        message,
        sender,
      );
    } catch (error) {
      return runtimeErrorResponse(error, isExtensionPageSender(sender, extensionId));
    }
  };
};
