/**
 * The Home read-only flag's verdict for the active account (issue 545). Split
 * from wallet-ops by the size budget; same privileged boundary and the same
 * passive session reads.
 */
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { readTypeOnlyInput } from "../routing/message-inputs";
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
    // An undeployed Argent account deploys and signs with the phrase key; an
    // undeployed Braavos account cannot be deployed from here yet, so nothing
    // can be signed for it either.
    return vendor === "argent"
      ? { accountId: account.id, ok: true, readOnly: false }
      : { accountId: account.id, ok: true, readOnly: true, reason: "braavos" };
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
  return restriction === null || restriction === undefined
    ? { accountId: account.id, ok: true, readOnly: false }
    : { accountId: account.id, ok: true, readOnly: true, reason: restriction };
};
