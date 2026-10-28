/**
 * Account-deployment message handlers: the reviewed self-paid deploy, and the
 * sponsored offer and submission (#431). Split from `wallet-ops` so the deploy
 * routes read on one screen.
 */

import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { readFeeReviewInput, readTypeOnlyInput } from "../routing/message-inputs";
import { activeAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";
import { submitReviewedAccountDeployment } from "./deployment-ops";
import {
  deploySponsorship,
  type SponsoredDeploymentDeps,
  submitSponsoredAccountDeployment,
} from "./sponsored-deployment";
import type { WalletStatusReader } from "./wallet-reader";

/** What the deploy handlers read; `WalletOpsDeps` satisfies it. */
export type DeployAccountDeps = SponsoredDeploymentDeps & {
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

type DeployHandler = (deps: DeployAccountDeps, message: unknown) => Promise<RuntimeResponse>;

/**
 * `wallet.deployAccount`: without `reviewedFee` it quotes the self-paid
 * deploy; with it, it signs and submits under that ceiling.
 */
export const handleDeployAccount: DeployHandler = async (deps, message) => {
  const input = readFeeReviewInput(message, "wallet.deployAccount");
  if (!input) return { error: "invalid deploy account request" };
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { error: context.error };
  const authorized = captureSessionAuthorization(deps.session);
  return submitReviewedAccountDeployment(deps, {
    account: context.account,
    isAuthorized: authorized.isCurrent,
    networkId: context.networkId,
    ...(input.reviewedFee ? { reviewedFee: input.reviewedFee } : {}),
    signHash: accountHashSigner(deps, context.account, context.vaultPassphrase),
  });
};

/**
 * `wallet.deploySponsorship`: whether the deploy screen may offer a sponsored
 * deploy. Sends no transaction; the answer is advisory and the submission
 * re-checks everything it depends on.
 */
export const handleDeploySponsorship: DeployHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.deploySponsorship")) {
    return { error: "invalid deploy sponsorship request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { error: context.error };
  const sponsorship = await deploySponsorship(deps, {
    account: context.account,
    signHash: accountHashSigner(deps, context.account, context.vaultPassphrase),
  });
  return { ok: true, sponsorship };
};

/**
 * `wallet.deployAccountSponsored`: deploys the active account with the
 * sponsor paying the fee. The user signs nothing; the session must still be
 * unlocked when the request leaves.
 */
export const handleDeployAccountSponsored: DeployHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.deployAccountSponsored")) {
    return { error: "invalid sponsored deploy request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { error: context.error };
  const authorized = captureSessionAuthorization(deps.session);
  return submitSponsoredAccountDeployment(deps, {
    account: context.account,
    isAuthorized: authorized.isCurrent,
  });
};
