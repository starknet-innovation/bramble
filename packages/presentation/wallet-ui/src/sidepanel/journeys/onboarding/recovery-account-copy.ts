/** Row copy and pick rules for the phrase-recovery account picker. Pure; no DOM. */

import {
  accountClassEntry,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  XVERSE_ARGENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import { ARGENT_ACCOUNT_CLASS_HASH, recoveryLadderIndex } from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";
import type {
  RecoveryAccountCandidate,
  RecoverySigningRestriction,
} from "@bramble/wallet-model/recovery";

// Only the classes this wallet deploys can be brought on chain from here: the
// pinned Argent release and Xverse's build of it (issue 734). A funded Argent
// 0.3.x address is a real counterfactual account, but deployment refuses its
// class, so "ready to deploy" would promise a transaction that is refused.
const deployableHere = (candidate: RecoveryAccountCandidate): boolean =>
  candidate.account.accountContractType === "openzeppelin" ||
  (candidate.account.accountContractType === "argent" &&
    (sameFelt(candidate.account.classHash, ARGENT_ACCOUNT_CLASS_HASH) ||
      sameFelt(candidate.account.classHash, XVERSE_ARGENT_CLASS_HASH))) ||
  (candidate.account.accountContractType === "braavos" &&
    sameFelt(candidate.account.classHash, BRAAVOS_DEPLOYMENT_CLASS_HASH));

// The scan's advisory verdict, in the reader's terms: why this account is
// watch-only here, said before they pick it rather than after a send fails.
const RESTRICTION_COPY: Record<RecoverySigningRestriction, string> = {
  guardian: "has a guardian",
  "owner-changed": "owner key changed",
  "owner-type": "unsupported signer",
  release: "unsupported release",
  "strong-signer": "2FA active",
};

// Said before they pick it, on its own line in the danger colour: another
// wallet registered this account with the privacy pool, and the pool keeps
// that key, so private balances stay off here. The row stays selectable — its
// public funds are reachable.
/** Row note under a deployed account another wallet registered with the privacy pool. */
export const PRIVACY_POOL_COPY = "Private balances off · set up in another wallet";

const deployedState = (candidate: RecoveryAccountCandidate): string =>
  candidate.restriction
    ? `Deployed on Starknet · ${RESTRICTION_COPY[candidate.restriction]} · view only`
    : "Deployed on Starknet";

const activityState = (candidate: RecoveryAccountCandidate): string => {
  if (candidate.deployed) return deployedState(candidate);
  if (candidate.funded) {
    return deployableHere(candidate)
      ? "Funded and ready to deploy"
      : "Funded on Starknet — Bramble cannot deploy this Argent release";
  }
  return candidate.account.accountContractType === "argent"
    ? "No on-chain activity found — Bramble only imports existing Ready accounts"
    : candidate.account.accountContractType === "braavos"
      ? "No on-chain activity found — Bramble only imports existing Braavos accounts"
      : "No on-chain activity found";
};

// A deployed Braavos account is usable exactly when its advisory verdict says
// so (stark key only, no strong signer); an undeployed one stays view-only,
// since Bramble cannot deploy Braavos accounts yet.
/** The row's state line: on-chain evidence and why it may be view only. Pure. */
export const candidateState = (candidate: RecoveryAccountCandidate, duplicate: boolean): string => {
  if (duplicate) return "Already in this wallet";
  if (
    candidate.account.accountContractType !== "braavos" ||
    (!candidate.deployed && !candidate.funded)
  ) {
    return activityState(candidate);
  }
  if (!candidate.deployed) {
    // The modern deployment class deploys from here like any other account;
    // an older base-class counterfactual still cannot.
    return deployableHere(candidate)
      ? "Funded and ready to deploy"
      : "Funded, not deployed · view only for now";
  }
  return deployedState(candidate);
};

// Two Argent releases at one index are two accounts, and so are the two key
// ladders (issue 505): the Ready extension's ETH-seeded key and the plain
// phrase key other Ready apps use. Name the release on any but the one Bramble
// creates, and the extension ladder, so rows that share an index can be told
// apart.
/** `Account N`, with the Argent release when it is not the one Bramble creates. Pure. */
export const candidateName = (candidate: RecoveryAccountCandidate): string => {
  const { account } = candidate;
  const title = `Account ${recoveryLadderIndex(account)}`;
  if (
    account.accountContractType !== "argent" ||
    sameFelt(account.classHash, ARGENT_ACCOUNT_CLASS_HASH)
  ) {
    return title;
  }
  const release = accountClassEntry(account.classHash)?.label.replace(/^argent /, "");
  return release ? `${title} · Argent ${release}` : title;
};

/** {@link candidateName} plus the key ladder, so rows sharing an index are distinct. Pure. */
export const candidateTitle = (candidate: RecoveryAccountCandidate): string =>
  candidate.account.derivation.kind === "argentx-bip44"
    ? `${candidateName(candidate)} · Ready extension`
    : candidateName(candidate);

// Bramble creates only Bramble accounts: any other candidate with no on-chain
// history would be a brand-new deployment in a family Bramble does not create,
// so it is listed but not selectable. Deployed or funded (counterfactual)
// accounts in those families stay importable.
/** Whether the picker lets this candidate be picked at all. Pure. */
export const selectable = (candidate: RecoveryAccountCandidate): boolean =>
  candidate.account.accountContractType === "openzeppelin" ||
  candidate.deployed ||
  candidate.funded;
