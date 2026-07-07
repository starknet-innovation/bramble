/**
 * Typed extension message handling for the background service worker.
 */

import type { StarkSignature } from "../crypto/krusty";
import { DEFAULT_NETWORK, STARKNET_NETWORKS } from "../starknet/networks";
import type { AccountRef, Vault } from "../storage/vault-schema";
import type {
  CreateVaultAccountInput,
  OriginGrantInput,
  SignHashInput,
  WalletStatus as VaultStatus,
} from "../wallet/vault-service";
import { type ApprovalQueue, createApprovalQueue, type PendingApproval } from "./approvals";
import {
  readApprovalIdInput,
  readCreateAccountInput,
  readGetGrantedAccountsInput,
  readGrantOriginInput,
  readRequestAccountsInput,
  readSignHashInput,
  readTypeOnlyInput,
  readUnlockInput,
} from "./message-inputs";
import {
  isExtensionPageSender,
  isPrivilegedMessage,
  isSenderOrigin,
  isTrustedSender,
  type RuntimeSender,
} from "./senders";
import { createUnlockSession, type UnlockSession } from "./session";

/**
 * Public status returned to popup and provider callers.
 */
export type WalletStatus = VaultStatus & {
  readonly network: string;
};

/**
 * Successful account-import response.
 */
export type CreateAccountResponse = {
  readonly account: AccountRef;
  readonly ok: true;
};

/**
 * Account list response scoped by origin grants.
 */
export type AccountsResponse = {
  readonly accounts: readonly AccountRef[];
  readonly ok: true;
};

/**
 * Successful signing response from the wallet service.
 */
export type SignHashResponse = {
  readonly ok: true;
  readonly signature: StarkSignature;
};

/**
 * Popup response containing dapp connection approvals.
 */
export type PendingApprovalResponse = {
  readonly ok: true;
  readonly pending: readonly PendingApproval[];
};

/**
 * Dapp account-request response, either granted or queued for approval.
 */
export type RequestAccountsResponse =
  | AccountsResponse
  | {
      readonly ok: false;
      readonly pending: PendingApproval;
    };

/**
 * Union of supported background message responses.
 */
export type RuntimeResponse =
  | AccountsResponse
  | CreateAccountResponse
  | PendingApprovalResponse
  | RequestAccountsResponse
  | SignHashResponse
  | WalletStatus
  | { readonly error: string };

/**
 * Narrow wallet service surface consumed by background message dispatch.
 */
export type WalletStatusReader = {
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<AccountRef>;
  readonly getGrantedAccounts: (
    origin: string,
    vaultPassphrase: string,
  ) => Promise<readonly AccountRef[]>;
  readonly grantOrigin: (input: OriginGrantInput) => Promise<readonly AccountRef[]>;
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
  readonly signHash: (input: SignHashInput) => Promise<StarkSignature>;
  readonly status: () => Promise<VaultStatus>;
};

const unavailableVaultStatus = (): VaultStatus => ({
  accountCount: 0,
  activeAccountId: null,
  hasVault: false,
  locked: true,
  ready: false,
});

const activeNetworkName = (vault: Vault): string => {
  const activeAccount = vault.accounts.find((account) => account.id === vault.activeAccountId);
  return activeAccount ? STARKNET_NETWORKS[activeAccount.networkId].name : DEFAULT_NETWORK.name;
};

const statusResponse = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
): Promise<WalletStatus> => {
  const status = await wallet.status();
  const passphrase = session.getPassphrase();
  if (!passphrase) {
    return { ...status, network: DEFAULT_NETWORK.name };
  }

  try {
    const vault = await wallet.readVault(passphrase);
    return {
      ...status,
      accountCount: vault.accounts.length,
      activeAccountId: vault.activeAccountId,
      locked: false,
      network: activeNetworkName(vault),
    };
  } catch {
    session.lock();
    return { ...status, network: DEFAULT_NETWORK.name };
  }
};

const isClaimedSenderOrigin = (
  sender: RuntimeSender | undefined,
  extensionId: string,
  origin: string,
): boolean => isExtensionPageSender(sender, extensionId) || isSenderOrigin(sender, origin);

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

  if (messageType === "wallet.createAccount") {
    const input = readCreateAccountInput(message);
    if (!input) {
      return { error: "invalid create account request" };
    }
    const account = await wallet.createAccount(input);
    session.unlock(input.vaultPassphrase);
    return { account, ok: true };
  }

  if (messageType === "wallet.approveOrigin") {
    const input = readApprovalIdInput(message);
    const passphrase = session.getPassphrase();
    if (!input) {
      return { error: "invalid approval request" };
    }
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    const approval = approvals.get(input.id);
    if (!approval) {
      return { error: "approval not found" };
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
    return statusResponse(wallet, session);
  }

  if (messageType === "wallet.status") {
    if (!readTypeOnlyInput(message, "wallet.status")) {
      return { error: "invalid status request" };
    }
    return statusResponse(wallet, session);
  }

  if (messageType === "wallet.unlock") {
    const input = readUnlockInput(message);
    if (!input) {
      return { error: "invalid unlock request" };
    }
    await wallet.readVault(input.vaultPassphrase);
    session.unlock(input.vaultPassphrase);
    return statusResponse(wallet, session);
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
  ) =>
  async (message: unknown, sender?: RuntimeSender): Promise<RuntimeResponse> => {
    try {
      return await handleRuntimeMessage(wallet, extensionId, session, approvals, message, sender);
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
    async getGrantedAccounts() {
      throw new Error("wallet unavailable");
    },
    async grantOrigin() {
      throw new Error("wallet unavailable");
    },
    async readVault() {
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
