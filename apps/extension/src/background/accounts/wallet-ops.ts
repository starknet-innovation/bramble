/** RPC-backed wallet operations dispatched from the background message handler. */

import type { MultisigStore } from "@bramble/multisig/repository";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { buildErc20TransferCall, type FeeEstimate, parseTokenAmount } from "@bramble/starknet/rpc";
import { type ActivityLog, activityToken, systemClock } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { type BalanceSnapshotStore, cachedBalances } from "../portfolio/balance-snapshots";
import type { NftSnapshotStore } from "../portfolio/nft-snapshots";
import { readAccountPortfolio } from "../portfolio/portfolio-balances";
import {
  readBalancesInput,
  readReviewTransferInput,
  readTransferInput,
  readTypeOnlyInput,
} from "../routing/message-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import {
  type ActiveStateCoordinator,
  networkRpcUrls,
  observedAccountContext,
  runActiveStateMutation,
  statusResponse,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import { readStrkBalance } from "../transactions/fee-guard";
import { FEE_REVIEW_REQUIRED } from "../transactions/fee-review";
import { reviewWalletFundedFees } from "../transactions/transfer-fee-review";
import { withTrustedRecipients } from "../transactions/trusted-recipients";
import { failureNoticeMessage } from "../transactions/tx-observation";
import {
  handleAccountSignability,
  handleRecoverArgentAccount,
  handleRecoverBraavosAccount,
  handleReviewArgentRecovery,
  handleReviewBraavosRecovery,
} from "./account-signability";
import { handleSetAccountHidden } from "./account-visibility-ops";
import { handleActivity } from "./activity-ops";
import {
  handleDeployAccount,
  handleDeployAccountSponsored,
  handleDeploySponsorship,
} from "./deploy-account-ops";
import { recordAutoDeployment } from "./deployment-ops";
import { handleResolveStarkName } from "./stark-name-ops";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Dependencies shared by the wallet, allowance, and NFT operations handlers.
 */
export type WalletOpsDeps = {
  /** Serializes network/account selection writes; production always supplies it. */
  readonly activeStateCoordinator?: ActiveStateCoordinator;
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly balanceSnapshots?: BalanceSnapshotStore;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger signing request with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  /**
   * Watched shared-account registry used only to authorize address-scoped,
   * read-only asset discovery. Signing paths resolve multisigs separately.
   */
  readonly multisigStore?: MultisigStore;
  /** Public, last-known ownership snapshots; transfer paths still re-prove live ownership. */
  readonly nftSnapshots?: NftSnapshotStore;
  /**
   * Wall-clock reader used to age transaction observation windows. Injected so
   * reconciliation stays deterministic under test; defaults to the system
   * clock boundary.
   */
  readonly now?: () => number;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Shared verifier scoping helper, re-exported from its home beside the verifier
 * so background modules keep one import path. Re-exporting rather than
 * re-deriving is the point: every caller resolves to the one network-filtered
 * implementation, so no path reviews against a wider context than another.
 */
export { verificationContext } from "@bramble/transactions/verify";

/**
 * Builds a hash signer for a resolved active-account context without exposing
 * the vault secret to caller modules.
 */
export const signerForContext = (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly vaultPassphrase: string },
) => accountHashSigner(deps, context.account, context.vaultPassphrase);

const transferContext = async (
  deps: WalletOpsDeps,
  input: { readonly accountId: string; readonly tokenId: string },
) => {
  const vaultPassphrase = deps.session.getPassphrase();
  const authorized = captureSessionAuthorization(deps.session);
  if (!vaultPassphrase) {
    return { error: "wallet locked" } as const;
  }
  const preferences = await deps.preferencesStore.read();
  if (!authorized.isCurrent()) return { error: "wallet locked" } as const;
  const vault = await deps.wallet.readVault(vaultPassphrase);
  if (!authorized.isCurrent()) return { error: "wallet locked" } as const;
  const account = vault.accounts.find((stored) => stored.id === input.accountId);
  const token = preferences.tokens.find((stored) => stored.id === input.tokenId);
  if (!account || account.networkId !== preferences.activeNetworkId) {
    return { error: "no account for selected network" } as const;
  }
  if (!token || token.networkId !== account.networkId) {
    return { error: "token unavailable" } as const;
  }
  // The recipient rule judges against every address the user knows: their
  // accounts, contacts, and the recipients this wallet has paid (audit #163).
  const trusted = await withTrustedRecipients(deps, preferences, vault.accounts);
  return { account, authorized, preferences: trusted, token, vaultPassphrase } as const;
};

/**
 * Classifies a transfer review's fee outcome so callers can tell an intentional
 * "no fee yet because the account still needs deployment" apart from a genuine
 * estimate failure. For an undeployed account the fee is intentionally null and
 * `feeEstimateFailed` stays false; for a deployed account that produced no
 * estimate the failure flag is set so the UI can surface a retry instead of a
 * dead "unavailable" string.
 */
export const resolveReviewFee = (input: {
  readonly deployed: boolean;
  readonly fee: FeeEstimate | null;
}): { readonly fee: FeeEstimate | null; readonly feeEstimateFailed: boolean } =>
  input.deployed
    ? { fee: input.fee, feeEstimateFailed: input.fee === null }
    : { fee: null, feeEstimateFailed: false };

type WalletOpsHandler = (deps: WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

// Side-panel reads use the non-renewing session so ambient polling cannot hold
// the wallet unlocked. User actions keep the renewing account-context path.
const passiveAccountContext = (deps: WalletOpsDeps) =>
  observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);

const handleGetBalances: WalletOpsHandler = async (deps, message) => {
  const input = readBalancesInput(message);
  if (!input) {
    return { error: "invalid balances request" };
  }
  const context = await passiveAccountContext(deps);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const network = STARKNET_NETWORKS[context.networkId];
  const now = (deps.now ?? systemClock)();
  const snapshot = await cachedBalances(
    deps.balanceSnapshots,
    {
      accountId: context.account.id,
      cachedOnly: input.cached,
      force: input.refresh,
      networkId: network.id,
      now,
    },
    (previous) =>
      readAccountPortfolio(
        deps,
        {
          accountAddress: context.account.address,
          forced: input.refresh,
          networkId: network.id,
          now,
          preferences,
          rpcUrls: networkRpcUrls(network, preferences),
          scope: `${deps.session.generation()}:${context.account.id}`,
        },
        previous,
      ),
  );
  if (!snapshot) return { error: "balance snapshot unavailable" };
  return {
    accountId: context.account.id,
    asOf: snapshot.fetchedAt > 0 ? snapshot.fetchedAt : null,
    balances: snapshot.balances,
    networkId: network.id,
    ok: true,
    stale: snapshot.stale,
  };
};

const handleDeploymentStatus: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.deploymentStatus")) {
    return { error: "invalid deployment status request" };
  }
  const context = await passiveAccountContext(deps);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const deployed = await deps.runtimeRpc.getDeploymentStatus({
    accountAddress: context.account.address,
    rpcUrls: networkRpcUrls(
      STARKNET_NETWORKS[context.networkId],
      await deps.preferencesStore.read(),
    ),
  });
  return { accountId: context.account.id, deployed, ok: true };
};

const handleVerifyClassHash: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.verifyClassHash")) {
    return { error: "invalid class hash verification request" };
  }
  const context = await passiveAccountContext(deps);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  if (!deps.runtimeRpc.verifyAccountClassHash) {
    return { error: "class hash verification unavailable" };
  }
  const verification = await deps.runtimeRpc.verifyAccountClassHash({
    accountAddress: context.account.address,
    expectedClassHash: context.account.classHash,
    rpcUrls: networkRpcUrls(
      STARKNET_NETWORKS[context.networkId],
      await deps.preferencesStore.read(),
    ),
  });
  return { accountId: context.account.id, ok: true, verification };
};

const handleReviewTransfer: WalletOpsHandler = async (deps, message) => {
  const input = readReviewTransferInput(message);
  if (!input) {
    return { error: "invalid transfer review request" };
  }
  const context = await transferContext(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, preferences, token, vaultPassphrase } = context;
  const amountRaw = parseTokenAmount(input.amount, token.decimals);
  const call = buildErc20TransferCall(token.address, input.recipient, amountRaw);
  const report = verifyCalls([call], verificationContext(account, preferences));
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
  const fees = await reviewWalletFundedFees(deps.runtimeRpc, {
    account,
    calls: [call],
    rpcUrls,
    signHash: accountHashSigner(deps, account, vaultPassphrase),
    speed: input.speed,
  });
  // Fee-affordability guard (issue 191): compare the estimate against the
  // account's STRK balance, counting the transfer amount itself when the sent
  // token is STRK (the fee competes with the amount). Warn-only and fail-open:
  // an unreadable balance yields "unknown" and no claim is made.
  const feeAffordability = resolveFeeAffordability({
    balance: fees.totalFee === null ? null : await readStrkBalance(deps, account, preferences),
    fee: fees.totalFee,
    sendAmount: sameFelt(token.address, STRK_TOKEN_ADDRESS) ? amountRaw : null,
  });
  return {
    ok: true,
    review: {
      deploymentFee: fees.deploymentFee,
      deploymentFeeEstimateFailed: fees.deploymentFeeEstimateFailed,
      fee: fees.fee,
      feeAffordability,
      feeEstimateFailed: fees.feeEstimateFailed,
      flags: report.flags,
      requiresDeployment: fees.requiresDeployment,
      // Deployment and the send are two transactions, so a device signs twice.
      // The review says so rather than letting the second prompt surprise.
      signsTwice: fees.requiresDeployment && account.derivation.kind === "ledger",
      summaries: report.calls.map((decoded) => decoded.summary),
    },
  };
};

const handleTransfer: WalletOpsHandler = async (deps, message) => {
  const input = readTransferInput(message);
  if (!input) {
    return { error: "invalid transfer request" };
  }
  const context = await transferContext(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, authorized, preferences, token, vaultPassphrase } = context;
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  // Verified BEFORE anything is broadcast. This call is built exactly as
  // `submitErc20Transfer` builds it (same parse, same encoder), so the report is
  // about the transaction that would actually go out, and running it first makes
  // the public send REFUSE a poisoned recipient (as the NFT send, the swap, and
  // the dapp invoke do) rather than annotate one after the fact.
  const report = verifyCalls(
    [
      buildErc20TransferCall(
        token.address,
        input.recipient,
        parseTokenAmount(input.amount, token.decimals),
      ),
    ],
    verificationContext(account, preferences),
  );
  const refusal = refuseOnPoisonedRecipient(report);
  if (refusal) {
    return refusal;
  }
  if (!input.reviewedFee) {
    return FEE_REVIEW_REQUIRED;
  }
  const activityFor = (hash: string) => ({
    accountId: account.id,
    amount: input.amount,
    counterparty: input.recipient,
    direction: "out" as const,
    hash,
    kind: "transfer" as const,
    networkId: account.networkId,
    summary: report.calls[0]?.summary ?? `Send ${token.symbol}`,
    ...activityToken(token),
  });
  // The invoke's signed hash, kept so a lost reply stays traceable (audit #173).
  let signedHash: string | undefined;
  let transactionHash: string;
  let deploymentHash: string | undefined;
  try {
    // The fee the review step showed, echoed back by the panel, is the ceiling this
    // send may sign under (MCW-V09-119); one whose cost ran past it is refused.
    const result = await deps.runtimeRpc.submitErc20Transfer({
      account,
      amount: input.amount,
      isAuthorized: authorized.isCurrent,
      onSigned: async (signed) => {
        signedHash = signed.transactionHash;
      },
      recipient: input.recipient,
      ...(input.reviewedDeploymentFee
        ? { reviewedDeploymentFee: input.reviewedDeploymentFee }
        : {}),
      reviewedFee: input.reviewedFee,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences),
      signHash: accountHashSigner(deps, account, vaultPassphrase),
      speed: input.speed,
      token,
    });
    ({ deploymentTransactionHash: deploymentHash, transactionHash } = result);
  } catch (error) {
    await afterBroadcast(() => recordAutoDeployment(deps.activity, account, error));
    if (!(error instanceof IndeterminateRpcWriteError)) {
      throw error;
    }
    // The transfer may already be on chain. Record it as pending so Activity
    // and the reconciler can follow it, and tell the panel the outcome is
    // unknown so it never offers a blind re-send.
    const pending = signedHash;
    if (pending !== undefined) {
      await afterBroadcast(() => recordSubmittedActivity(deps.activity, activityFor(pending)));
    }
    return submissionUnknownResponse(error.message, signedHash);
  }
  await afterBroadcast(() => recordAutoDeployment(deps.activity, account, deploymentHash));
  await afterBroadcast(() => recordSubmittedActivity(deps.activity, activityFor(transactionHash)));
  return { ok: true, transactionHash };
};

/**
 * Drains the failure notices background reconciliation recorded while the side
 * panel was closed. Each notice is returned exactly once; the activity entry
 * keeps its terminal status whether or not the notice was ever displayed.
 *
 * Multisig transactions and deployments are journaled under the multisig's own
 * id, not the signing account's, so every stored multisig on the active network
 * is drained too; otherwise their late failures were never shown (Sherlock
 * 221). A scope whose drain fails is skipped, so one bad read never hides the
 * others.
 */
const handleTransactionAlerts: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.transactionAlerts")) {
    return { error: "invalid transaction alerts request" };
  }
  const context = await passiveAccountContext(deps);
  if (context.error !== undefined) {
    return { alerts: [], ok: true };
  }
  const multisigs = (await deps.multisigStore?.listMultisigs().catch(() => [])) ?? [];
  const accountIds = [
    context.account.id,
    ...multisigs
      .filter((record) => record.networkId === context.networkId)
      .map((record) => record.id),
  ];
  const alerts: string[] = [];
  for (const accountId of accountIds) {
    const entries = await deps.activity
      .takeFailureNotices({ accountId, networkId: context.networkId })
      .catch(() => []);
    alerts.push(...entries.map(failureNoticeMessage));
  }
  return { alerts, ok: true };
};

const handleLock: WalletOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.lock")) {
    return { error: "invalid lock request" };
  }
  // A Ledger request may itself hold the active-state coordinator while the
  // panel/device round-trip is parked. Revoke it before waiting for that
  // coordinator so an explicit lock cannot be held behind the signature it is
  // meant to cancel. Later queued operations stay behind the lock mutation and
  // observe the revoked session.
  deps.ledgerSignQueue?.rejectAll("wallet locked");
  deps.session.lock();
  return runActiveStateMutation(deps.activeStateCoordinator, async () => {
    // An unlock that was already inside the coordinator may have completed
    // after the eager revocation. Lock once more at our serialized position so
    // the later user intent wins deterministically.
    deps.ledgerSignQueue?.rejectAll("wallet locked");
    deps.session.lock();
    // Reporting "locked" is a security claim, so only make it once the
    // plaintext session mirror is confirmed erased. A mirror that survived the
    // lock fails closed with an error instead of a locked status the user would
    // read as "the passphrase is gone".
    try {
      await deps.session.mirrorCleared();
    } catch {
      return { error: "wallet lock incomplete" };
    }
    return statusResponse(deps.wallet, deps.session, deps.preferencesStore);
  });
};

/**
 * Dispatch table for wallet operation messages, keyed by message type. Keeping
 * each branch a self-contained handler leaves the router a pure lookup.
 */
const WALLET_OPS_HANDLERS: Readonly<Record<string, WalletOpsHandler>> = {
  "wallet.activity": handleActivity,
  "wallet.deployAccount": handleDeployAccount,
  "wallet.deployAccountSponsored": handleDeployAccountSponsored,
  "wallet.deploySponsorship": handleDeploySponsorship,
  "wallet.accountSignability": handleAccountSignability,
  "wallet.recoverArgentAccount": handleRecoverArgentAccount,
  "wallet.recoverBraavosAccount": handleRecoverBraavosAccount,
  "wallet.reviewArgentRecovery": handleReviewArgentRecovery,
  "wallet.reviewBraavosRecovery": handleReviewBraavosRecovery,
  "wallet.deploymentStatus": handleDeploymentStatus,
  "wallet.getBalances": handleGetBalances,
  "wallet.lock": handleLock,
  "wallet.resolveStarkName": handleResolveStarkName,
  "wallet.reviewTransfer": handleReviewTransfer,
  "wallet.setAccountHidden": (deps, message) => handleSetAccountHidden(deps, message),
  "wallet.transactionAlerts": handleTransactionAlerts,
  "wallet.transfer": handleTransfer,
  "wallet.verifyClassHash": handleVerifyClassHash,
};

/**
 * Handles wallet operation messages; returns null for other message types.
 */
export const handleWalletOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(WALLET_OPS_HANDLERS, messageType)
    ? WALLET_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message) : null;
};
