/**
 * dApp-facing `wallet_addDeclareTransaction` handling. A connected origin may
 * ask the wallet to declare a contract class, but the declare is never
 * auto-submitted: it is validated and queued as a "declare" approval whose
 * response is held until the user approves in the side panel. The large
 * CONTRACT_CLASS stays in the private approval payload, never in the UI
 * snapshot. On approve the declare is signed and submitted through the RPC
 * layer; on deny the held request settles as a refusal.
 */
import { isProviderDeclare, type ProviderDeclare } from "../provider/declare-params";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { normalizeWalletOrigin } from "../shared/origin";
import { STARKNET_NETWORKS } from "../starknet/networks";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { accountHashSigner } from "./account-hash-signer";
import { notifyApprovalsChanged } from "./approval-notifier";
import type { ApprovalQueue } from "./approvals";
import type { LedgerSignQueue } from "./ledger-sign-queue";
import type { RuntimeRpc } from "./runtime-rpc";
import { networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import { isClaimedSenderOrigin, type RuntimeSender } from "./senders";
import type { UnlockSession } from "./session";
import type { SignatureWaiters } from "./signature-waiters";

/**
 * Dependencies for the dapp declare handler.
 */
export type DeclareOpsDeps = {
  readonly approvals: ApprovalQueue;
  readonly extensionId: string;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
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
    declare: input.declare,
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
 * error response instead of throwing so the caller can keep the approval queued.
 */
export const executeDeclareApproval = async (
  deps: DeclareExecuteDeps,
  input: { readonly declare: ProviderDeclare; readonly origin: string },
): Promise<RuntimeResponse> => {
  const { preferencesStore, runtimeRpc, session, wallet } = deps;
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
  // A keyless Ledger account signs on the device (verified against publicKeyX),
  // every other account through the vault — the same seam wallet-initiated txns
  // use. A Ledger account with no queue wired throws, aborting the submit.
  const result = await runtimeRpc.submitDeclareTransaction({
    account,
    compiledClassHash: input.declare.compiledClassHash,
    contractClass: input.declare.contractClass,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
    signHash: accountHashSigner(deps, account, passphrase),
    ...(input.declare.classHash === undefined ? {} : { classHash: input.declare.classHash }),
  });
  return { classHash: result.classHash, ok: true, transactionHash: result.transactionHash };
};
