/**
 * Typed extension message handling for the background service worker.
 */

import { DEFAULT_NETWORK, networkIdForChainId, STARKNET_NETWORKS } from "../starknet/networks";
import { typedDataHash } from "../starknet/typed-data";
import { type ActivityLog, memoryActivityLog } from "../storage/activity-store";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { type ApprovalQueue, createApprovalQueue } from "./approvals";
import {
  readAddInvokeTransactionInput,
  readApprovalIdInput,
  readCreateAccountInput,
  readGetGrantedAccountsInput,
  readGrantOriginInput,
  readRequestAccountsInput,
  readSetActiveAccountInput,
  readSetActiveNetworkInput,
  readSignHashInput,
  readSignTypedDataInput,
  readSwitchChainInput,
  readTypeOnlyInput,
  readUnlockInput,
} from "./message-inputs";
import { handlePreferenceOps } from "./preference-ops";
import { handleProviderOps } from "./provider-ops";
import { defaultRuntimeRpc, type RuntimeRpc } from "./runtime-rpc";
import {
  networkRpcUrls,
  statusResponse,
  switchActiveNetwork,
  unavailablePreferencesStore,
} from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import {
  isClaimedSenderOrigin,
  isExtensionPageSender,
  isPrivilegedMessage,
  isTrustedSender,
  type RuntimeSender,
} from "./senders";
import { createUnlockSession, type UnlockSession } from "./session";
import { handleWalletOps } from "./wallet-ops";

const unavailableVaultStatus = () => ({
  accountCount: 0,
  activeAccountId: null,
  hasVault: false,
  locked: true,
  ready: false,
});

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

  const opsResponse = await handleWalletOps(
    { activity, preferencesStore, runtimeRpc, session, wallet },
    messageType,
    message,
  );
  if (opsResponse) {
    return opsResponse;
  }

  const preferenceResponse = await handlePreferenceOps(preferencesStore, messageType, message);
  if (preferenceResponse) {
    return preferenceResponse;
  }

  const providerOpsResponse = await handleProviderOps(
    { approvals, extensionId, preferencesStore, runtimeRpc, session, wallet },
    messageType,
    message,
    sender,
  );
  if (providerOpsResponse) {
    return providerOpsResponse;
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

  if (messageType === "wallet.approveOrigin") {
    const input = readApprovalIdInput(message);
    if (!input) {
      return { error: "invalid approval request" };
    }
    const approval = approvals.get(input.id);
    if (!approval) {
      return { error: "approval not found" };
    }
    if (approval.kind === "watch-asset") {
      if (!approval.token) {
        return { error: "approval not found" };
      }
      await preferencesStore.upsertToken(approval.token);
      approvals.approve(input.id);
      return { ok: true, pending: approvals.list() };
    }
    const passphrase = session.getPassphrase();
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    const accounts = await wallet.grantOrigin({
      origin: approval.origin,
      vaultPassphrase: passphrase,
    });
    approvals.approve(input.id);
    return {
      accounts,
      ok: true,
    };
  }

  if (messageType === "wallet.denyOrigin") {
    const input = readApprovalIdInput(message);
    if (!input) {
      return { error: "invalid approval request" };
    }
    approvals.deny(input.id);
    return { ok: true, pending: approvals.list() };
  }

  if (messageType === "wallet.generateMnemonic") {
    if (!readTypeOnlyInput(message, "wallet.generateMnemonic")) {
      return { error: "invalid generate mnemonic request" };
    }
    return { mnemonic: await wallet.generateMnemonic(), ok: true };
  }

  if (messageType === "wallet.addInvokeTransaction") {
    const input = readAddInvokeTransactionInput(message);
    const passphrase = session.getPassphrase();
    if (!input) {
      return { error: "invalid invoke request" };
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
    const result = await runtimeRpc.submitInvokeTransaction({
      account,
      calls: input.calls,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
      signHash: (messageHash) =>
        wallet.signHash({ accountId: account.id, messageHash, vaultPassphrase: passphrase }),
    });
    await activity.record({
      accountId: account.id,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: account.networkId,
      summary: `${input.origin} submitted ${input.calls.length} call${input.calls.length === 1 ? "" : "s"}`,
    });
    return { ok: true, transactionHash: result.transactionHash };
  }

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
  }

  if (messageType === "wallet.getChainId") {
    if (!readTypeOnlyInput(message, "wallet.getChainId")) {
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
    const account = await switchActiveNetwork(wallet, session, preferencesStore, networkId);
    if (
      passphrase &&
      account &&
      granted.length > 0 &&
      !granted.some((item) => item.id === account.id)
    ) {
      await wallet.grantOrigin({
        accountId: account.id,
        origin: input.origin,
        vaultPassphrase: passphrase,
      });
    }
    return { chainId: STARKNET_NETWORKS[networkId].chainId, ok: true };
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
    const vaultPassphrase = input.vaultPassphrase ?? session.getPassphrase();
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
    return { ok: true, pending: approvals.list() };
  }

  if (messageType === "wallet.requestAccounts") {
    const input = readRequestAccountsInput(message);
    if (!input) {
      return { error: "invalid request accounts request" };
    }
    if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
      return { error: "sender origin mismatch" };
    }
    const passphrase = session.getPassphrase();
    if (passphrase) {
      const accounts = await wallet.getGrantedAccounts(input.origin, passphrase);
      if (accounts.length > 0) {
        return { accounts, ok: true };
      }
    }
    return { ok: false, pending: approvals.request(input.origin) };
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
    await wallet.readVault(input.vaultPassphrase);
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
 * Creates the trusted background runtime message dispatcher.
 */
export const createMessageHandler =
  (
    wallet: WalletStatusReader,
    extensionId: string,
    session: UnlockSession = createUnlockSession(),
    approvals: ApprovalQueue = createApprovalQueue(),
    preferencesStore: WalletPreferencesStore = unavailablePreferencesStore,
    runtimeRpc: RuntimeRpc = defaultRuntimeRpc,
    activity: ActivityLog = memoryActivityLog(),
  ) =>
  async (message: unknown, sender?: RuntimeSender): Promise<RuntimeResponse> => {
    try {
      return await handleRuntimeMessage(
        wallet,
        extensionId,
        session,
        approvals,
        preferencesStore,
        runtimeRpc,
        activity,
        message,
        sender,
      );
    } catch (error) {
      return runtimeErrorResponse(error, isExtensionPageSender(sender, extensionId));
    }
  };

/**
 * Test fallback handler used when no real background wallet service is wired.
 */
export const handleMessage = createMessageHandler(
  {
    async createAccount() {
      throw new Error("wallet unavailable");
    },
    async ensureNetworkAccount() {
      throw new Error("wallet unavailable");
    },
    async getGrantedAccounts() {
      throw new Error("wallet unavailable");
    },
    async generateMnemonic() {
      throw new Error("wallet unavailable");
    },
    async grantOrigin() {
      throw new Error("wallet unavailable");
    },
    async readVault() {
      throw new Error("wallet unavailable");
    },
    async setActiveAccount() {
      throw new Error("wallet unavailable");
    },
    async signHash() {
      throw new Error("wallet unavailable");
    },
    async status() {
      return unavailableVaultStatus();
    },
  },
  "mc-wallet-test",
);
