/**
 * dApp-facing `wallet_addDeclareTransaction` handling. A connected origin may
 * ask the wallet to declare a contract class, but the declare is never
 * auto-submitted: it is validated and queued as a "declare" approval whose
 * response is held until the user approves in the side panel. The large
 * CONTRACT_CLASS stays in the private approval payload, never in the UI
 * snapshot. On approve the declare is signed and submitted through the RPC
 * layer; on deny the held request settles as a refusal.
 */

import { walletErrorMessage } from "@mc-wallet/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { normalizeWalletOrigin } from "@mc-wallet/core/origin";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import { isProviderDeclare, type ProviderDeclare } from "@mc-wallet/wallet-protocol/declare";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@mc-wallet/permissions/blocklist";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import { accountHashSigner } from "../ledger/account-hash-signer";
import { type ApprovalContext, createApprovalContext } from "../approvals/approval-context";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue } from "../approvals/approvals";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "../routing/senders";
import type { UnlockSession } from "../runtime/session";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import type { WalletStatusReader } from "../accounts/wallet-reader";

/**
 * Dependencies for the dapp declare handler.
 */
export type DeclareOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
};

/**
 * Dependencies needed to execute a held declare approval once the user signs off.
 */
export type DeclareExecuteDeps = {
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger declare with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Parses a `wallet.addDeclareTransaction` runtime message crossed from the
 * content bridge, re-validating the declare payload and normalizing the origin.
 */
const readAddDeclareTransactionInput = (
  message: unknown,
): { readonly declare: ProviderDeclare; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["declare", "origin", "type"]) ||
    message["type"] !== "wallet.addDeclareTransaction" ||
    !isProviderDeclare(message["declare"])
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { declare: message["declare"], origin } : null;
};

const declareSummaries = (declare: ProviderDeclare): readonly string[] => [
  `Compiled class hash ${declare.compiledClassHash}`,
  ...(declare.classHash === undefined ? [] : [`Class hash ${declare.classHash}`]),
];

const countArray = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const declarationStructure = (declare: ProviderDeclare) => {
  const contract = isRecord(declare.contractClass) ? declare.contractClass : {};
  const entryPoints = isRecord(contract["entry_points_by_type"])
    ? Object.values(contract["entry_points_by_type"]).reduce<number>(
        (total, entries) => total + countArray(entries),
        0,
      )
    : 0;
  return {
    abiEntryCount: countArray(contract["abi"]),
    ...(declare.classHash === undefined ? {} : { classHash: declare.classHash }),
    compiledClassHash: declare.compiledClassHash,
    entryPointCount: entryPoints,
    sierraProgramLength: countArray(contract["sierra_program"]),
  };
};

const declarationReview = async (
  deps: DeclareOpsDeps,
  account: AccountRef,
  declare: ProviderDeclare,
  preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>,
  passphrase: string,
) => {
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
  let accountDeployment: "deployed" | "undeployed" | "unknown" = "unknown";
  try {
    accountDeployment = (await deps.runtimeRpc.getDeploymentStatus({
      accountAddress: account.address,
      rpcUrls,
    }))
      ? "deployed"
      : "undeployed";
  } catch {
    accountDeployment = "unknown";
  }
  const fee = deps.runtimeRpc.estimateDeclareFee
    ? await deps.runtimeRpc
        .estimateDeclareFee({
          account,
          compiledClassHash: declare.compiledClassHash,
          contractClass: declare.contractClass,
          rpcUrls,
          signHash: accountHashSigner(deps, account, passphrase, "declare-class"),
          ...(declare.classHash === undefined ? {} : { classHash: declare.classHash }),
        })
        .catch(() => null)
    : null;
  const deploymentFee =
    accountDeployment === "undeployed" && deps.runtimeRpc.estimateAccountDeploymentFee
      ? await deps.runtimeRpc
          .estimateAccountDeploymentFee({
            account,
            rpcUrls,
            signHash: accountHashSigner(deps, account, passphrase, "deploy-account"),
          })
          .catch(() => null)
      : null;
  return {
    ...declarationStructure(declare),
    accountDeployment,
    deploymentFee,
    deploymentFeeEstimateFailed: accountDeployment === "undeployed" && deploymentFee === null,
    fee,
    feeEstimateFailed: fee === null,
  };
};

const declarationErrorMessage = (error: unknown): string => {
  const curated = walletErrorMessage(error, "");
  if (curated) {
    return curated;
  }
  const message = error instanceof Error ? error.message : "";
  if (/already declared/i.test(message)) {
    return "This contract class is already declared on the selected network.";
  }
  if (/insufficient|balance|fee.*exceed|max.*fee/i.test(message)) {
    return "The account does not have enough STRK to pay the declaration fee.";
  }
  if (/compiled class hash|class hash.*mismatch/i.test(message)) {
    return "The declaration artifact does not match its compiled class hash.";
  }
  if (/validation|validate/i.test(message)) {
    return "The account contract rejected the declaration during Starknet validation.";
  }
  return "Starknet rejected the declaration. Check the account's STRK balance, network, and class hashes, then try again.";
};

/**
 * Handles a dapp declare message; returns null for other message types.
 */
export const handleDeclareOps = async (
  deps: DeclareOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  if (messageType !== "wallet.addDeclareTransaction") {
    return null;
  }
  const { approvals, extensionId, preferencesStore, session, waiters, wallet } = deps;
  const guard = deps.guard ?? DEFAULT_ORIGIN_GUARD;
  const input = readAddDeclareTransactionInput(message);
  if (!input) {
    return { error: "invalid declare request" };
  }
  if (!isClaimedSenderOrigin(sender, extensionId, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if (guard.isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
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
  const approval = approvals.requestDeclare({
    context: await createApprovalContext(account, { declare: input.declare }),
    declare: input.declare,
    declaration: await declarationReview(deps, account, input.declare, preferences, passphrase),
    origin: input.origin,
    summaries: declareSummaries(input.declare),
  });
  notifyApprovalsChanged();
  return waiters.register(approval.id);
};

/**
 * Executes a user-approved declare: re-resolves the active account for the
 * origin (a locked wallet or revoked grant fails safely), submits the held
 * declare, and returns the node's transaction and class hashes. Returns an
 * actionable error response instead of throwing so the claimed request and
 * held dapp promise settle together without leaving stale approval controls.
 */
export const executeDeclareApproval = async (
  deps: DeclareExecuteDeps,
  input: {
    readonly context?: ApprovalContext;
    readonly declare: ProviderDeclare;
    readonly origin: string;
  },
): Promise<RuntimeResponse> => {
  const { preferencesStore, runtimeRpc, session, wallet } = deps;
  const passphrase = session.getPassphrase();
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
  // A keyless Ledger account signs on the device (verified against publicKeyX),
  // every other account through the vault — the same seam wallet-initiated txns
  // use. A device rejection/timeout/verify-failure, or a Ledger account with no
  // queue wired, throws a WalletError from the sign path: catch it and return
  // `{ error }` (mirroring executeStrk20InvokeApproval) so the applier settles
  // the held dapp request with the real reason instead of leaving it to hang on
  // an unhandled throw. Fails closed — nothing is submitted on error.
  try {
    const result = await runtimeRpc.submitDeclareTransaction({
      account,
      compiledClassHash: input.declare.compiledClassHash,
      contractClass: input.declare.contractClass,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
      signHash: accountHashSigner(deps, account, passphrase, "declare-class"),
      ...(input.declare.classHash === undefined ? {} : { classHash: input.declare.classHash }),
    });
    return { classHash: result.classHash, ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    return { error: declarationErrorMessage(error) };
  }
};
