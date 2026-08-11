/**
 * Pure multisig response validators for background runtime data, kept out of
 * responses.ts so that file stays within the size budget.
 */

import { hasOnlyKnownKeys, isJson, isRecord } from "../shared/json";
import {
  isMultisigConfirmationMode,
  type MultisigConfirmationMode,
} from "../shared/multisig-confirmation";
import { isMultisigSyncWarning, type MultisigSyncWarning } from "../shared/multisig-sync";
import type { FeeEstimate } from "../starknet/fee-bounds";
import { isStarkFieldElement } from "../starknet/networks";
import {
  isMultisigProposalRecord,
  isMultisigRecord,
  type MultisigProposalRecord,
  type MultisigRecord,
} from "../storage/multisig-store";
import { isAccountId } from "../storage/vault-schema";
import { isFeeShape } from "./responses-transfer";

/**
 * Fee review for one exact signer, proposal, and confirmation mode.
 */
export type MultisigConfirmationReviewResponse = {
  readonly confirmationReview: {
    readonly fee: FeeEstimate | null;
    readonly feeEstimateFailed: boolean;
    readonly mode: MultisigConfirmationMode;
    readonly proposalId: string;
    readonly signerAccountId: string;
  };
  readonly ok: true;
};

/**
 * Checks a pre-sign multisig fee review returned by the background.
 */
export const isMultisigConfirmationReviewResponse = (
  value: unknown,
): value is MultisigConfirmationReviewResponse => {
  if (
    !isRecord(value) ||
    !isJson(value) ||
    !hasOnlyKnownKeys(value, ["confirmationReview", "ok"]) ||
    value["ok"] !== true ||
    !isRecord(value["confirmationReview"]) ||
    !hasOnlyKnownKeys(value["confirmationReview"], [
      "fee",
      "feeEstimateFailed",
      "mode",
      "proposalId",
      "signerAccountId",
    ])
  ) {
    return false;
  }
  const review = value["confirmationReview"];
  return (
    (review["fee"] === null || isFeeShape(review["fee"])) &&
    typeof review["feeEstimateFailed"] === "boolean" &&
    isMultisigConfirmationMode(review["mode"]) &&
    typeof review["proposalId"] === "string" &&
    review["proposalId"].length > 0 &&
    review["proposalId"].length <= 200 &&
    isAccountId(review["signerAccountId"])
  );
};

/**
 * Watched multisigs and proposals accepted from the background boundary.
 */
export type MultisigsResponse = {
  readonly multisigs: readonly MultisigRecord[];
  readonly ok: true;
  readonly proposals: readonly MultisigProposalRecord[];
};

/**
 * Checks multisig list responses before rendering.
 */
export const isMultisigsResponse = (value: unknown): value is MultisigsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["multisigs", "ok", "proposals"]) &&
  value["ok"] === true &&
  Array.isArray(value["multisigs"]) &&
  value["multisigs"].every(isMultisigRecord) &&
  Array.isArray(value["proposals"]) &&
  value["proposals"].every(isMultisigProposalRecord);

/**
 * One watched multisig accepted from the background boundary after an add or
 * refresh, optionally carrying refreshed proposals.
 */
export type MultisigResponse = {
  readonly multisig: MultisigRecord;
  readonly ok: true;
  readonly proposals?: readonly MultisigProposalRecord[];
  readonly warnings?: readonly MultisigSyncWarning[];
};

/**
 * Checks single-multisig responses before rendering.
 */
export const isMultisigResponse = (value: unknown): value is MultisigResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["multisig", "ok", "proposals", "warnings"]) &&
  value["ok"] === true &&
  isMultisigRecord(value["multisig"]) &&
  (value["proposals"] === undefined ||
    (Array.isArray(value["proposals"]) && value["proposals"].every(isMultisigProposalRecord))) &&
  (value["warnings"] === undefined ||
    (Array.isArray(value["warnings"]) &&
      value["warnings"].length <= 2 &&
      value["warnings"].every(isMultisigSyncWarning)));

/**
 * One tracked proposal accepted from the background boundary, with the
 * submission hash when a transaction was broadcast.
 */
export type MultisigProposalResponse = {
  readonly ok: true;
  readonly proposal: MultisigProposalRecord;
  readonly transactionHash?: string;
};

/**
 * Checks proposal responses before rendering.
 */
export const isMultisigProposalResponse = (value: unknown): value is MultisigProposalResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "proposal", "transactionHash"]) &&
  value["ok"] === true &&
  isMultisigProposalRecord(value["proposal"]) &&
  (value["transactionHash"] === undefined ||
    (typeof value["transactionHash"] === "string" &&
      isStarkFieldElement(value["transactionHash"])));

/**
 * Pinned-class declaration status accepted from the background boundary.
 */
export type MultisigClassStatusResponse = {
  readonly declared: boolean;
  readonly declarationPending: boolean;
  readonly ok: true;
  readonly transactionHash?: string;
};

/**
 * Public declaration state rendered by the deploy flow after the response
 * envelope has been validated.
 */
export type MultisigClassState = Omit<MultisigClassStatusResponse, "ok">;

/**
 * Checks class-status responses before rendering the deploy screen.
 */
export const isMultisigClassStatusResponse = (
  value: unknown,
): value is MultisigClassStatusResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["declarationPending", "declared", "ok", "transactionHash"]) &&
  value["ok"] === true &&
  typeof value["declared"] === "boolean" &&
  typeof value["declarationPending"] === "boolean" &&
  (value["transactionHash"] === undefined ||
    (value["declarationPending"] === true &&
      typeof value["transactionHash"] === "string" &&
      isStarkFieldElement(value["transactionHash"]))) &&
  !(value["declared"] && value["declarationPending"]);

/**
 * Deploy submission accepted from the background boundary with the predicted
 * multisig address.
 */
export type MultisigDeployResponse = {
  readonly address: string;
  readonly ok: true;
  readonly tracked: boolean;
  readonly transactionHash: string;
};

/**
 * Checks deploy responses before rendering.
 */
export const isMultisigDeployResponse = (value: unknown): value is MultisigDeployResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["address", "ok", "tracked", "transactionHash"]) &&
  value["ok"] === true &&
  typeof value["address"] === "string" &&
  isStarkFieldElement(value["address"]) &&
  typeof value["tracked"] === "boolean" &&
  typeof value["transactionHash"] === "string" &&
  isStarkFieldElement(value["transactionHash"]);

/**
 * Bare acknowledgement accepted from the background boundary.
 */
export const isOkResponse = (value: unknown): value is { readonly ok: true } =>
  isRecord(value) && isJson(value) && hasOnlyKnownKeys(value, ["ok"]) && value["ok"] === true;
