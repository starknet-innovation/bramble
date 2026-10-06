/**
 * Phrase-driven Ready (Argent) guardian removal: the owner key alone escapes
 * the guardian, in the two steps the account's escape carve-out accepts from a
 * single owner signature — `trigger_escape_guardian(None)` starts the
 * security period, then from `ready_at` until `ready_at + period`
 * `escape_guardian()` removes the guardian at once and the account signs
 * normally again; past that window the escape expires and must be started
 * again. Cancelling in between needs the owner AND guardian together. Starting
 * an escape silently replaces any pending owner escape (the guardian's flow),
 * so that case is surfaced and needs an explicit acknowledgement. An account
 * with a backup guardian cannot escape to None and is refused up front. This module
 * deliberately bypasses the guardian refusal that guards every other
 * submission, mirroring the account's own carve-out.
 */
import { WalletError } from "@bramble/core/errors";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RecoverySigningRestriction } from "@bramble/wallet-model/recovery";
import type { RpcProvider } from "starknet";
import type { FeeEstimate } from "../rpc/fee-bounds";
import {
  type AccountHashSigner,
  argentQueryAccount,
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
  krustyAccount,
  matchingAcceptedRpcWriteHash,
  withRpcFallback,
  withRpcWrite,
} from "../rpc/provider";
import { argentSigningRestriction, atAcceptedBlock } from "./account-compatibility";
import {
  type ArgentRecoveryState,
  type ArgentRecoveryStatus,
  BACKUP_PRESENT,
  BACKUP_UNCHECKED,
  ESCAPE_TOO_RECENT,
  isEscapeTooRecentRevert,
  isRetryableReadError,
  type PendingEscapeChange,
  readEscapeState,
  readGuardianBackup,
  requireEscapeAttemptAllowed,
} from "./argent-escape-state";

export { type ArgentRecoveryState, getArgentRecoveryState } from "./argent-escape-state";

import {
  capturingRecoverySigner,
  RECOVERY_TIP,
  recoveryFeeCeiling,
  refuseKeylessRecovery,
  requireWithinReviewedRecoveryFee,
  UNRECOVERABLE_SIGNERS,
} from "./recovery-shared";

// The account rejects an escape transaction whose fee exceeds this on-chain cap
// (MAX_ESCAPE_MAX_FEE_STRK, 5 STRK in fri), an anti-griefing bound. Enforced
// here too so the wallet never signs a request the account would reject.
const MAX_ESCAPE_FEE_FRI = 5n * 10n ** 18n;

// Each restriction's own refusal. `release` covers both an unknown class and
// a known one whose authorization this wallet cannot produce, so it says only
// what is true of both.
const ARGENT_REFUSALS: Partial<Record<RecoverySigningRestriction, string>> = {
  "owner-changed": "Deployed Argent account owner does not match the wallet signer",
  "owner-type": "Deployed Argent account owner type is not supported by this wallet",
  release: "Deployed Argent account class is not one this wallet can recover",
};

/** The step a confirmation offers: start the escape, or complete a ready one. */
export type ArgentRecoveryStep = "complete" | "start";

/**
 * What the confirmation states: the step, the maximum fee, the window in which
 * the removal can be completed (estimated from the latest block for a start,
 * the account's own for a completion), and the pending escape starting would
 * cancel, if any.
 */
export type ArgentRecoveryReview = {
  readonly expiresAt: number;
  readonly fee: FeeEstimate;
  readonly readyAt: number;
  readonly replaces: PendingEscapeChange | null;
  readonly step: ArgentRecoveryStep;
};

/**
 * Inputs shared by the Ready recovery review and submission. The submission
 * must name the `expectedStep` the user confirmed, and `replaceEscapeReadyAt`
 * — the `readyAt` of the pending escape its confirmation warned about — when
 * starting would cancel one; any other escape found at submit is refused.
 * `onSigned` receives the hash after signing and before broadcast.
 */
export type ArgentRecoveryInput = {
  readonly account: AccountRef;
  readonly expectedStep?: ArgentRecoveryStep;
  readonly isAuthorized?: () => boolean;
  readonly onSigned?: (transactionHash: string) => void;
  readonly replaceEscapeReadyAt?: number;
  readonly reviewedFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: AccountHashSigner;
};

// Serde for Cairo's Option<Signer>: None is the single felt 1. Removing the
// guardian escapes it to None.
const REMOVE_GUARDIAN_CALLDATA = ["0x1"] as const;

const triggerCall = (address: string) => ({
  calldata: [...REMOVE_GUARDIAN_CALLDATA],
  contractAddress: address,
  entrypoint: "trigger_escape_guardian",
});
const completeCall = (address: string) => ({
  calldata: [] as string[],
  contractAddress: address,
  entrypoint: "escape_guardian",
});

// The flow applies only to a deployed, phrase-held Argent account whose sole
// restriction is a guardian; anything else is refused before signing. The
// gate, the escape state, the step chosen from it and the escape-limit clock
// are read at one pinned accepted block, so they all coexisted.
const recoverableStep = async (
  provider: RpcProvider,
  account: AccountRef,
  pickStep: (state: ArgentRecoveryState) => ArgentRecoveryStep,
): Promise<{ readonly state: ArgentRecoveryState; readonly step: ArgentRecoveryStep }> => {
  if (account.accountContractType !== "argent") {
    throw new WalletError("Account recovery is only available for Ready accounts");
  }
  refuseKeylessRecovery(account);
  return atAcceptedBlock(provider, async (blockIdentifier) => {
    await requireRecoverableArgentAt(provider, account, blockIdentifier);
    const state = await readEscapeState(provider, account.address, blockIdentifier);
    const step = pickStep(state);
    // The account's one-attempt-per-12-hours limit, checked before any
    // estimate so it is refused in words rather than as a raw revert.
    await requireEscapeAttemptAllowed(provider, account.address, step, blockIdentifier);
    return { state, step };
  });
};

const requireRecoverableArgentAt = async (
  provider: RpcProvider,
  account: AccountRef,
  blockIdentifier: string,
): Promise<void> => {
  const restriction = await argentSigningRestriction(
    provider,
    { address: account.address, publicKeyX: account.publicKeyX },
    blockIdentifier,
  );
  if (restriction === null) {
    throw new WalletError("This account has no guardian to remove");
  }
  if (restriction !== "guardian") {
    throw new WalletError(ARGENT_REFUSALS[restriction] ?? UNRECOVERABLE_SIGNERS);
  }
  // Transport failures and pinned-block misses propagate (endpoint fallback,
  // re-pin); any other failed read refuses rather than letting the escape revert.
  const backup = await readGuardianBackup(provider, account.address, blockIdentifier).catch(
    (error: unknown) => {
      if (isRetryableReadError(error)) throw error;
      throw new WalletError(BACKUP_UNCHECKED);
    },
  );
  if (backup === "present") {
    throw new WalletError(BACKUP_PRESENT);
  }
};

// Which escape step advances the removal from the live status: start it when
// none is pending or the last one expired, complete it once it is ready, and
// refuse while the security period is still running.
const nextStep = (status: ArgentRecoveryStatus): ArgentRecoveryStep => {
  if (status === "none" || status === "expired") return "start";
  if (status === "ready") return "complete";
  throw new WalletError("Guardian removal is still in its waiting period");
};

const callFor = (address: string, step: ArgentRecoveryStep) =>
  step === "start" ? triggerCall(address) : completeCall(address);

// Validated estimate through the query signer: the escape call does real work
// in __validate__ (the rate-limit bookkeeping) that a skipped-validation quote
// under-prices, and the account accepts a shape-correct dummy owner entry for
// a query-version transaction. No key — phrase or Ledger — is asked to sign.
const estimateStep = (
  provider: RpcProvider,
  account: AccountRef,
  step: ArgentRecoveryStep,
  makeQueryAccount: typeof argentQueryAccount,
) =>
  makeQueryAccount(provider, account)
    .estimateInvokeFee(callFor(account.address, step), {
      skipValidate: false,
      tip: RECOVERY_TIP,
    })
    .catch((error: unknown) => {
      // A race past the pinned check (another escape landed since): the same
      // limit, matched on the account's own revert reason, never a catch-all.
      if (isEscapeTooRecentRevert(error)) throw new WalletError(ESCAPE_TOO_RECENT);
      throw error;
    });

// The live step, refused unless it is the one the user confirmed and, when it
// cancels a pending escape, the acknowledgement names that exact escape (a
// cancelled and re-triggered one has a different ready_at).
const confirmedStep = (
  state: ArgentRecoveryState,
  expectedStep: ArgentRecoveryStep,
  replaceEscapeReadyAt: number | undefined,
): ArgentRecoveryStep => {
  const step = nextStep(state.status);
  if (step !== expectedStep) {
    throw new WalletError("The recovery step changed. Review it and try again.");
  }
  const pending = step === "start" ? state.pendingChange : null;
  if (pending !== null && replaceEscapeReadyAt !== pending.readyAt) {
    throw new WalletError(
      pending.kind === "owner-escape"
        ? "A guardian-approved key change is pending. Review it and try again."
        : "A guardian change is pending. Review it and try again.",
    );
  }
  return step;
};

/**
 * Estimates the next escape step and returns what its confirmation states.
 * Refuses an account the flow does not apply to, an escape still in its
 * waiting period, and a fee over the account's on-chain escape cap.
 */
export const reviewArgentRecovery = async (
  { account, rpcUrls }: ArgentRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeQueryAccount: typeof argentQueryAccount = argentQueryAccount,
): Promise<ArgentRecoveryReview> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      const { state, step } = await recoverableStep(provider, account, (live) =>
        nextStep(live.status),
      );
      const estimate = await estimateStep(provider, account, step, makeQueryAccount);
      const fee = recoveryFeeCeiling(estimate, MAX_ESCAPE_FEE_FRI);
      if (step === "complete" && state.readyAt !== null && state.expiresAt !== null) {
        return {
          expiresAt: state.expiresAt,
          fee,
          readyAt: state.readyAt,
          replaces: null,
          step,
        };
      }
      const block = await provider.getBlock("latest");
      const readyAt = Number(block.timestamp) + state.securityPeriodSeconds;
      return {
        expiresAt: readyAt + state.securityPeriodSeconds,
        fee,
        readyAt,
        replaces: state.pendingChange,
        step: "start",
      };
    },
    makeProvider,
  );

/**
 * Submits the confirmed escape step and returns its hash and the escape window
 * after it (null once completed). Refuses before signing when the live step
 * differs from `expectedStep`, when the pending escape found is not the one
 * the confirmation acknowledged, or when the fresh estimate exceeds the confirmed fee or the
 * on-chain cap. Once the node has accepted the hash, any later failure is
 * indeterminate: the step may be on chain.
 */
export const submitArgentRecovery = async (
  input: ArgentRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
  makeQueryAccount: typeof argentQueryAccount = argentQueryAccount,
): Promise<{
  readonly expiresAt: number | null;
  readonly readyAt: number | null;
  readonly transactionHash: string;
}> => {
  const { account, expectedStep, reviewedFee, rpcUrls } = input;
  return withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      if (!reviewedFee || expectedStep === undefined) {
        throw new WalletError("The recovery was not reviewed. Review it and try again.");
      }
      const { step } = await recoverableStep(provider, account, (live) =>
        confirmedStep(live, expectedStep, input.replaceEscapeReadyAt),
      );
      const estimate = await estimateStep(provider, account, step, makeQueryAccount);
      requireWithinReviewedRecoveryFee(estimate, reviewedFee, MAX_ESCAPE_FEE_FRI);
      const capture = capturingRecoverySigner(input.signHash, input.isAuthorized, input.onSigned);
      const submitted = await makeAccount(provider, account, capture.signer).execute(
        callFor(account.address, step),
        { resourceBounds: estimate.resourceBounds, tip: RECOVERY_TIP },
      );
      const transactionHash = matchingAcceptedRpcWriteHash(
        submitted.transaction_hash,
        capture.signedHash(),
      );
      try {
        await provider.waitForTransaction(transactionHash);
        const after = await readEscapeState(provider, account.address);
        return { expiresAt: after.expiresAt, readyAt: after.readyAt, transactionHash };
      } catch {
        throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
      }
    },
    makeProvider,
  );
};
