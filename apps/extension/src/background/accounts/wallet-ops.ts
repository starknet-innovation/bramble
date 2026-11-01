/** RPC-backed wallet operations dispatched from the background message handler. */

import type { FeeEstimate } from "@bramble/starknet/rpc";
import { systemClock } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { accountHashSigner } from "../ledger/account-hash-signer";
import { cachedBalances } from "../portfolio/balance-snapshots";
import { readAccountPortfolio } from "../portfolio/portfolio-balances";
import { readBalancesInput, readTypeOnlyInput } from "../routing/message-inputs";
import {
  networkRpcUrls,
  observedAccountContext,
  runActiveStateMutation,
  statusResponse,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
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
import { handleResolveStarkName } from "./stark-name-ops";
import { handleReviewTransfer, handleTransfer } from "./transfer-ops";
import type { WalletOpsDeps } from "./wallet-ops-deps";

/**
 * Shared verifier scoping helper, re-exported from its home beside the verifier
 * so background modules keep one import path. Re-exporting rather than
 * re-deriving is the point: every caller resolves to the one network-filtered
 * implementation, so no path reviews against a wider context than another.
 */
export { verificationContext } from "@bramble/transactions/verify";
/**
 * Dependencies shared by the wallet, allowance, and NFT operations handlers.
 */
export type { WalletOpsDeps } from "./wallet-ops-deps";

/**
 * Builds a hash signer for a resolved active-account context without exposing
 * the vault secret to caller modules.
 */
export const signerForContext = (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly vaultPassphrase: string },
) => accountHashSigner(deps, context.account, context.vaultPassphrase);

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
