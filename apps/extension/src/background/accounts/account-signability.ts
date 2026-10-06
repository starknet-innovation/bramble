/**
 * The Home read-only flag's verdict for the active account (issue 545). Split
 * from wallet-ops by the size budget; same privileged boundary and the same
 * passive session reads.
 */
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { DEFAULT_ARGENT_ESCAPE_SECURITY_PERIOD_SECONDS as ARGENT_ESCAPE_DELAY_SECONDS } from "@bramble/starknet/rpc";
import { isDeployableBraavos } from "@bramble/wallet-model/account-families";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
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

// An undeployed Argent account deploys inside its first transaction. A Braavos
// counterfactual on the modern deployment class deploys only through the
// explicit Deploy account step (the transaction path refuses deploy-then-act
// for it), so until then it cannot send; an older Braavos base class stays
// view-only, since its deployment authorization has not been established.
const undeployedVerdict = (
  accountId: string,
  vendor: "argent" | "braavos",
  classHash: string,
): RuntimeResponse => {
  if (vendor === "argent") return { accountId, ok: true, readOnly: false };
  const reason = isDeployableBraavos({ accountContractType: vendor, classHash })
    ? "undeployed"
    : "braavos";
  return { accountId, ok: true, readOnly: true, reason };
};

/**
 * The Home read-only flag's verdict: deployed vendor accounts by live probe,
 * undeployed Braavos unable to send until deployed, everything else
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
  // A phrase-recoverable restriction (Braavos 2FA, Ready guardian) attaches
  // what the Home flag needs: any in-progress removal's unlock time and, for
  // Ready's two-step escape, whether it is now ready to complete. Best-effort;
  // the flag renders without it.
  const recovery = await recoveryState(deps, account, restriction, rpcUrls);
  return {
    accountId: account.id,
    ok: true,
    readOnly: true,
    reason: restriction,
    ...(recovery ? { recovery } : {}),
  };
};

const recoveryState = async (
  deps: AccountSignabilityDeps,
  account: { readonly address: string },
  restriction: string,
  rpcUrls: readonly string[],
): Promise<
  | {
      readonly delaySeconds: number;
      readonly pendingUntil: number | null;
      readonly stage?: "pending" | "ready";
    }
  | undefined
> => {
  if (restriction === "strong-signer") {
    return deps.runtimeRpc
      .getBraavosRecoveryState?.({ accountAddress: account.address, rpcUrls })
      .catch(() => undefined);
  }
  if (restriction !== "guardian") return undefined;
  const state = await deps.runtimeRpc
    .getArgentRecoveryState?.({ accountAddress: account.address, rpcUrls })
    .catch(() => undefined);
  // Only an escape already under way carries a stage; none/expired leaves the
  // flag offering a fresh "Recover account".
  if (!state || (state.status !== "pending" && state.status !== "ready")) return undefined;
  return {
    delaySeconds: ARGENT_ESCAPE_DELAY_SECONDS,
    pendingUntil: state.readyAt,
    stage: state.status,
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

/**
 * Quotes the Ready recovery's next escape step (fee + the delay it will take),
 * mirroring the Braavos review. Privileged; the estimate signs only a
 * query-version transaction, which can never be submitted.
 */
export const handleReviewArgentRecovery = async (
  deps: AccountSignabilityDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.reviewArgentRecovery")) {
    return { error: "invalid recovery review request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { error: context.error };
  const { account } = context;
  if (!("publicKeyX" in account) || !deps.runtimeRpc.reviewArgentRecovery) {
    return { error: "account recovery unavailable" };
  }
  const rpcUrls = networkRpcUrls(
    STARKNET_NETWORKS[context.networkId],
    await deps.preferencesStore.read(),
  );
  const fee = await deps.runtimeRpc.reviewArgentRecovery({
    account,
    rpcUrls,
    signHash: accountHashSigner(deps, account, context.vaultPassphrase),
  });
  return { accountId: account.id, delaySeconds: ARGENT_ESCAPE_DELAY_SECONDS, fee, ok: true };
};

/**
 * Submits the reviewed Ready recovery step (trigger, or complete once ready).
 * The reviewed fee bounds the transaction; the platform layer re-reads the
 * escape state and the live class before anything is signed.
 */
export const handleRecoverArgentAccount = async (
  deps: AccountSignabilityDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readFeeReviewInput(message, "wallet.recoverArgentAccount");
  if (!input) return { error: "invalid account recovery request" };
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { error: context.error };
  const { account } = context;
  if (!("publicKeyX" in account) || !deps.runtimeRpc.submitArgentRecovery) {
    return { error: "account recovery unavailable" };
  }
  const authorized = captureSessionAuthorization(deps.session);
  const submitted = await deps.runtimeRpc.submitArgentRecovery({
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
    pendingUntil: submitted.readyAt,
    transactionHash: submitted.transactionHash,
  };
};
