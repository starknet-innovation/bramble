/**
 * One vault's script, rebuilt from scratch: Krusty's commitments for `v`,
 * checked against the root the journal recorded when `v` was allocated, then
 * the pinned bridge's `setup_from_commitments` through the digest-checked
 * runtime, then the public state checked as the coordinator checks it.
 *
 * This is Bramble's own guard that a script is really this vault's: the
 * coordinator binds a vault to its script hash and never checks the script
 * against the commitments (spec flag F1). Every caller compares the result
 * with what the journal and the coordinator hold before anything is sent.
 * Every failure is the caller's refusal (`mismatch`) or `runtimeUnavailable`.
 */
import { isQsbPublicState } from "@bramble/qsb/registration";
import type { QsbCommitments } from "@bramble/vault/kms-port";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import { type QsbVaultRefusal, qsbRefusal } from "./qsb-vault-refusals";
import type { QsbVaultDeps } from "./qsb-vault-session";
import type { QsbHorsCommitments, QsbVaultSetup } from "./qsb-vault-setup";

/** A vault's commitments, in round order, and the script built from them. */
export type QsbBuiltVault = {
  readonly commitments: QsbHorsCommitments;
  readonly script: QsbVaultSetup;
};

/**
 * Rebuilds vault `v`'s script. Refuses with `mismatch` when Krusty's root is
 * not the journal's `root`, and with `runtimeUnavailable` when the runtime
 * fails or returns a public state the coordinator would refuse.
 */
export const rebuildQsbVault = async (
  deps: QsbVaultDeps,
  access: Pick<QsbVaultAccess, "commitments">,
  record: { readonly root: string; readonly v: number },
  mismatch: QsbVaultRefusal,
): Promise<QsbBuiltVault> => {
  const derived = await access.commitments(record.v);
  if (derived.root !== record.root) {
    throw qsbRefusal(mismatch);
  }
  return buildQsbVault(deps, derived);
};

/**
 * Builds the script of Krusty's `derived` commitments for one vault, with no
 * journal root to check them against (recovery, where the journal is what is
 * being rebuilt). Refuses with `runtimeUnavailable` when the runtime fails or
 * returns a public state the coordinator would refuse.
 */
export const buildQsbVault = async (
  deps: QsbVaultDeps,
  derived: QsbCommitments,
): Promise<QsbBuiltVault> => {
  const commitments: QsbHorsCommitments = [derived.round0, derived.round1];
  let script: QsbVaultSetup;
  try {
    script = await deps.runtime.setupFromCommitments(commitments);
  } catch {
    throw qsbRefusal("runtimeUnavailable");
  }
  if (!isQsbPublicState(script.publicStateJson)) {
    throw qsbRefusal("runtimeUnavailable");
  }
  return { commitments, script };
};
