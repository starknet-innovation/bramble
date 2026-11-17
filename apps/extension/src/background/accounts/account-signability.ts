/**
 * The Home read-only flag's verdict for the active account (issue 545). Split
 * from wallet-ops by the size budget; same privileged boundary and the same
 * passive session reads.
 */
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { isDeployableBraavos } from "@bramble/wallet-model/account-families";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { readTypeOnlyInput } from "../routing/message-inputs";
import type { AccountRecoveryState } from "../runtime/recovery-types";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
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
  // A failed read is no verdict, never "undeployed": a deployed Braavos must
  // not flip to "Not deployed" on an RPC flake. Unknown answers signable, as
  // a failed probe does below; the transaction path still checks for real.
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
    .catch(() => null);
  if (deployed === null) {
    return { accountId: account.id, ok: true, readOnly: false };
  }
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
): Promise<AccountRecoveryState | undefined> => {
  if (restriction === "strong-signer") {
    return deps.runtimeRpc
      .getBraavosRecoveryState?.({ accountAddress: account.address, rpcUrls })
      .catch(() => undefined);
  }
  if (restriction !== "guardian") return undefined;
  const state = await deps.runtimeRpc
    .getArgentRecoveryState?.({ accountAddress: account.address, rpcUrls })
    .catch(() => undefined);
  if (!state) return undefined;
  const delaySeconds = state.securityPeriodSeconds;
  // A backup guardian blocks the phrase escape outright; an unanswered read
  // is treated the same way (no Recover button), never as "no backup".
  if (state.guardianBackup !== "absent") {
    return {
      delaySeconds,
      pendingUntil: null,
      stage: state.guardianBackup === "present" ? "backup-guardian" : "backup-unknown",
    };
  }
  // A guardian-approved key change in progress is surfaced, never read as
  // "nothing pending": starting a guardian escape would cancel it.
  if (state.pendingChange !== null) {
    // An owner escape, or a guardian escape to a NEW guardian: either way not a
    // removal this flow can show as pending or complete.
    return { delaySeconds, pendingUntil: null, stage: state.pendingChange.kind };
  }
  // No escape: the flag offers a fresh "Recover account". A running, ready or
  // expired one carries its window so the flag can state it.
  if (state.status === "none" || state.readyAt === null || state.expiresAt === null) {
    return undefined;
  }
  return {
    delaySeconds,
    expiresAt: state.expiresAt,
    pendingUntil: state.readyAt,
    stage: state.status,
  };
};

// The recovery review/submit handlers live in account-recovery.ts (size
// budget); re-exported so the wallet-ops handler table keeps one import path.
export {
  handleRecoverArgentAccount,
  handleRecoverBraavosAccount,
  handleReviewArgentRecovery,
  handleReviewBraavosRecovery,
} from "./account-recovery";
