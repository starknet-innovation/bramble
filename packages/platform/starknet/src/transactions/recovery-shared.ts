/**
 * Guards shared by the phrase-driven recovery flows (Braavos 2FA removal and
 * the Ready guardian escape). Both remove a second factor from an account, so
 * both bind the submission to exactly what the user confirmed: the fee
 * ceiling the confirmation stated, the session that authorized it, and the
 * hash that was actually signed. Kept in one place so the two flows cannot
 * drift apart on any of those checks.
 */
import { WalletError } from "@bramble/core/errors";
import { type AccountRef, isKeylessAccount } from "@bramble/wallet-model/accounts";
import {
  authorizedSpendFor,
  type FeeEstimate,
  type NodeFeeEstimate,
  REVIEWED_FEE_HEADROOM,
} from "../rpc/fee-bounds";
import type { AccountHashSigner } from "../rpc/provider";

/**
 * Tip every recovery transaction carries. Zero keeps the Ready escape inside
 * the account's `MAX_ESCAPE_TIP_STRK` (1 STRK) and adds nothing to the spend
 * the resource bounds imply, so the fee ceiling below is the whole charge.
 */
export const RECOVERY_TIP = "0x0";

/** Refusal shown when the submit-time estimate no longer fits the confirmed fee. */
const RECOVERY_FEE_CHANGED = "The recovery fee changed. Review it and try again.";

/** The submit-time spend in fri, or null when it is not a readable STRK figure. */
const spendFri = (estimate: NodeFeeEstimate): bigint | null => {
  const spend = authorizedSpendFor(estimate, "standard");
  return spend !== null && spend.unit === "FRI" ? BigInt(spend.overallFee) : null;
};

/**
 * The fee a recovery confirmation states as its maximum: the validated
 * estimate's authorized spend (resource bounds, not the headline figure) lifted
 * by {@link REVIEWED_FEE_HEADROOM}, never above the account's on-chain cap.
 * The headroom absorbs gas-price movement between review and submit; the
 * submission is then held to this figure exactly, so the number the user saw
 * is a true ceiling. Throws when the bounds cannot be read in STRK or the
 * estimate itself already exceeds the cap the account would enforce.
 */
export const recoveryFeeCeiling = (estimate: NodeFeeEstimate, capFri: bigint): FeeEstimate => {
  const spend = spendFri(estimate);
  if (spend === null) {
    throw new WalletError("The recovery fee could not be read in STRK.");
  }
  if (spend > capFri) {
    throw new WalletError("Recovery fee exceeds the account's on-chain cap");
  }
  const lifted =
    (spend * BigInt(REVIEWED_FEE_HEADROOM.numerator)) / BigInt(REVIEWED_FEE_HEADROOM.denominator);
  return { overallFee: (lifted < capFri ? lifted : capFri).toString(), unit: "FRI" };
};

/**
 * Refuses a submission whose fresh estimate would authorize more than the fee
 * the user confirmed, or more than the account's on-chain cap, or which cannot
 * be read in STRK. A missing reviewed fee is refused outright. Fails closed.
 */
export const requireWithinReviewedRecoveryFee = (
  estimate: NodeFeeEstimate,
  reviewedFee: FeeEstimate | undefined,
  capFri: bigint,
): void => {
  if (!reviewedFee) {
    throw new WalletError("The recovery fee was not reviewed. Review it and try again.");
  }
  const spend = spendFri(estimate);
  if (
    spend === null ||
    reviewedFee.unit !== "FRI" ||
    spend > BigInt(reviewedFee.overallFee) ||
    spend > capFri
  ) {
    throw new WalletError(RECOVERY_FEE_CHANGED);
  }
};

/**
 * Refusal for a restriction the recovery flow does not lift and that no more
 * specific message describes (e.g. a restriction another vendor reports).
 */
export const UNRECOVERABLE_SIGNERS =
  "This account's signer setup cannot be recovered with the recovery phrase";

/**
 * Recovery is a phrase flow. A Ledger account's key never leaves the device,
 * which could only blind-sign this hash, so the flows refuse it before any
 * estimate or prompt rather than asking for a device approval of a second
 * factor's removal that the device cannot describe.
 */
export const refuseKeylessRecovery = (account: AccountRef): void => {
  if (isKeylessAccount(account)) {
    throw new WalletError("Account recovery is not available for Ledger accounts");
  }
};

/**
 * Wraps the submission signer: the unlock session is re-checked after the hash
 * is signed (an explicit lock revokes the in-flight submission), and the hash
 * is captured — and reported through `onSigned` before broadcast — so the
 * caller can match it against the hash the node accepts and journal a write
 * whose reply is lost.
 */
export const capturingRecoverySigner = (
  signHash: AccountHashSigner,
  isAuthorized: (() => boolean) | undefined,
  onSigned: ((transactionHash: string) => void) | undefined,
): { readonly signedHash: () => string | undefined; readonly signer: AccountHashSigner } => {
  let signedHash: string | undefined;
  return {
    signedHash: () => signedHash,
    signer: async (messageHash) => {
      const signed = await signHash(messageHash);
      if (isAuthorized?.() === false) {
        throw new WalletError("wallet locked");
      }
      signedHash = messageHash;
      onSigned?.(messageHash);
      return signed;
    },
  };
};
