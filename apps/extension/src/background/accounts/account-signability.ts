/**
 * The Home read-only flag's verdict for the active account (issue 545). Split
 * from wallet-ops by the size budget; same privileged boundary and the same
 * passive session reads.
 */
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { BRAAVOS_DEPLOYMENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { accountHashSigner } from "../ledger/account-hash-signer";
import { readFeeReviewInput, readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import {
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";
import type { WalletStatusReader } from "./wallet-reader";

// The slice of the wallet-ops dependency set this handler reads. Structural on
// purpose: wallet-ops hands its full deps in, and this module never imports
// from it, so the two cannot form a cycle.
type AccountSignabilityDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

// Side-panel reads use the non-renewing session so ambient polling cannot hold
// the wallet unlocked.
const passiveAccountContext = (deps: AccountSignabilityDeps) =>
  observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);

// An undeployed Argent account deploys and signs with the phrase key, and so
// does a Braavos counterfactual on the modern deployment class; only an older
// Braavos base class stays view-only, since its deployment authorization has not
// been established.
const undeployedVerdict = (
  accountId: string,
  vendor: "argent" | "braavos",
  classHash: string,
): RuntimeResponse =>
  vendor === "argent" || sameFelt(classHash, BRAAVOS_DEPLOYMENT_CLASS_HASH)
    ? { accountId, ok: true, readOnly: false }
    : { accountId, ok: true, readOnly: true, reason: "braavos" };

/**
 * The Home read-only flag's verdict: deployed vendor accounts by live probe,
 * undeployed Braavos read-only (deployment unsupported), everything else
 * signs. Advisory — a failed probe answers signable rather than alarming on an
 * RPC flake; the transaction path keeps its authoritative fail-closed checks.
 */
export const handleAccountSignability = async (
  deps: AccountSignabilityDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.accountSignability")) {
    return { error: "invalid account signability request" };
  }
  const context = await passiveAccountContext(deps);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const { account } = context;
  const vendor =
    account.accountContractType === "argent" || account.accountContractType === "braavos"
      ? account.accountContractType
      : null;
  if (vendor === null || !("publicKeyX" in account)) {
    return { accountId: account.id, ok: true, readOnly: false };
  }
  const rpcUrls = networkRpcUrls(
    STARKNET_NETWORKS[context.networkId],
    await deps.preferencesStore.read(),
  );
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
    .catch(() => false);
  if (!deployed) {
    return undeployedVerdict(account.id, vendor, account.classHash);
  }
  const probe =
    vendor === "argent"
      ? deps.runtimeRpc.getArgentSigningRestriction
      : deps.runtimeRpc.getBraavosSigningRestriction;
  const restriction = await probe?.({
    accountAddress: account.address,
    publicKeyX: account.publicKeyX,
    rpcUrls,
  }).catch(() => null);
  if (restriction === null || restriction === undefined) {
    return { accountId: account.id, ok: true, readOnly: false };
  }
  // A strong signer is recoverable with the phrase: attach what the Home flag
  // needs — the pending expiry if a request is live, or the delay a fresh one
  // would take. Best-effort; the flag renders without it.
  const recovery =
    restriction === "strong-signer"
      ? await deps.runtimeRpc
          .getBraavosRecoveryState?.({ accountAddress: account.address, rpcUrls })
          .catch(() => undefined)
      : undefined;
  return {
    accountId: account.id,
    ok: true,
    readOnly: true,
    reason: restriction,
    ...(recovery ? { recovery } : {}),
  };
};

/**
 * Quotes the Braavos recovery request for its review card: the fee, and the
 * delay after which the removal takes effect. Privileged; the phrase key signs
 * only a query-version estimate, which can never be submitted.
 */
export const handleReviewBraavosRecovery = async (
  deps: AccountSignabilityDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.reviewBraavosRecovery")) {
    return { error: "invalid recovery review request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { error: context.error };
  const { account } = context;
  if (!("publicKeyX" in account) || !deps.runtimeRpc.reviewBraavosRecovery) {
    return { error: "account recovery unavailable" };
  }
  const rpcUrls = networkRpcUrls(
    STARKNET_NETWORKS[context.networkId],
    await deps.preferencesStore.read(),
  );
  const fee = await deps.runtimeRpc.reviewBraavosRecovery({
    account,
    rpcUrls,
    signHash: accountHashSigner(deps, account, context.vaultPassphrase),
  });
  const state = await deps.runtimeRpc
    .getBraavosRecoveryState?.({ accountAddress: account.address, rpcUrls })
    .catch(() => undefined);
  return {
    accountId: account.id,
    delaySeconds: state?.delaySeconds ?? null,
    fee,
    ok: true,
  };
};

/**
 * Submits the reviewed Braavos recovery request. The reviewed fee is mandatory
 * and bounds the transaction; the platform layer re-checks the account state
 * and the on-chain fee cap before anything is signed.
 */
export const handleRecoverBraavosAccount = async (
  deps: AccountSignabilityDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readFeeReviewInput(message, "wallet.recoverBraavosAccount");
  if (!input) return { error: "invalid account recovery request" };
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { error: context.error };
  const { account } = context;
  if (!("publicKeyX" in account) || !deps.runtimeRpc.submitBraavosRecovery) {
    return { error: "account recovery unavailable" };
  }
  const authorized = captureSessionAuthorization(deps.session);
  const submitted = await deps.runtimeRpc.submitBraavosRecovery({
    account,
    isAuthorized: authorized.isCurrent,
    ...(input.reviewedFee ? { reviewedFee: input.reviewedFee } : {}),
    rpcUrls: networkRpcUrls(
      STARKNET_NETWORKS[context.networkId],
      await deps.preferencesStore.read(),
    ),
    signHash: accountHashSigner(deps, account, context.vaultPassphrase),
  });
  return {
    accountId: account.id,
    ok: true,
    pendingUntil: submitted.pendingUntil,
    transactionHash: submitted.transactionHash,
  };
};
