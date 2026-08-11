/**
 * Typed runtime message client for the side panel's multisig screens, kept
 * out of runtime.ts so that file stays within the size budget. Every reply
 * is validated by the multisig response guards before the UI trusts it.
 */

import type { MultisigConfirmationMode } from "@mc-wallet/multisig/confirmation";
import type { MultisigProposalCall } from "@mc-wallet/multisig/repository";
import {
  isMultisigClassStatusResponse,
  isMultisigConfirmationReviewResponse,
  isMultisigDeployResponse,
  isMultisigProposalResponse,
  isMultisigResponse,
  isMultisigsResponse,
  isOkResponse,
  type MultisigClassState,
  type MultisigConfirmationReviewResponse,
  type MultisigDeployResponse,
  type MultisigsResponse,
} from "../../../popup/responses/multisig-responses";
import {
  isBalancesResponse,
  isErrorResponse,
  isTransferResponse,
} from "../../../popup/responses/responses";
import type { RuntimeApi, ScopedBalanceState } from "../../runtime/runtime";
import type { MultisigSyncState } from "./multisig-sync";

const responseError = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

/**
 * Multisig client surface returned by createMultisigClient.
 */
export type MultisigClient = ReturnType<typeof createMultisigClient>;

/**
 * Creates side panel multisig actions over chrome.runtime messaging.
 */
export const createMultisigClient = (runtime?: RuntimeApi) => {
  const sendMessage = async (message: unknown): Promise<unknown> => runtime?.sendMessage(message);

  return {
    async addMultisig(address: string, name: string): Promise<void> {
      const response = await sendMessage({
        address,
        ...(name ? { name } : {}),
        type: "wallet.addMultisig",
      });
      if (!isMultisigResponse(response)) {
        throw responseError(response, "add multisig failed");
      }
    },
    async confirmProposal(input: {
      readonly mode: MultisigConfirmationMode;
      readonly proposalId: string;
      readonly signerAccountId: string;
      readonly untrackedVerified?: boolean;
    }): Promise<string> {
      const response = await sendMessage({
        mode: input.mode,
        proposalId: input.proposalId,
        signerAccountId: input.signerAccountId,
        type: "wallet.confirmMultisigProposal",
        ...(input.untrackedVerified ? { untrackedVerified: true } : {}),
      });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "confirm failed");
    },
    async prepareConfirmation(input: {
      readonly mode: MultisigConfirmationMode;
      readonly proposalId: string;
      readonly signerAccountId: string;
      readonly untrackedVerified?: boolean;
    }): Promise<MultisigConfirmationReviewResponse["confirmationReview"]> {
      const response = await sendMessage({
        mode: input.mode,
        proposalId: input.proposalId,
        signerAccountId: input.signerAccountId,
        type: "wallet.prepareMultisigConfirmation",
        ...(input.untrackedVerified ? { untrackedVerified: true } : {}),
      });
      if (isMultisigConfirmationReviewResponse(response)) {
        return response.confirmationReview;
      }
      throw responseError(response, "confirmation review failed");
    },
    async declareClass(): Promise<string> {
      const response = await sendMessage({ type: "wallet.declareMultisigClass" });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "declare failed");
    },
    async deployMultisig(
      signers: readonly string[],
      quorum: number,
      salt: string,
    ): Promise<MultisigDeployResponse> {
      const response = await sendMessage({
        quorum,
        ...(salt ? { salt } : {}),
        signers,
        type: "wallet.deployMultisig",
      });
      if (isMultisigDeployResponse(response)) {
        return response;
      }
      throw responseError(response, "deploy failed");
    },
    async executeProposal(proposalId: string, signerAccountId: string): Promise<string> {
      const response = await sendMessage({
        proposalId,
        signerAccountId,
        type: "wallet.executeMultisigProposal",
      });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "execute failed");
    },
    // Resolves to the declared flag, or "error" when the status cannot be
    // determined (RPC failure, unavailable surface, malformed reply). Never
    // rejects, so the deploy screen can tell "still loading" (null in the
    // cache) apart from "checked and failed" and offer a retry instead of
    // hanging on the checking state.
    async loadClassStatus(): Promise<MultisigClassState | "error"> {
      try {
        const response = await sendMessage({ type: "wallet.multisigClassStatus" });
        return isMultisigClassStatusResponse(response)
          ? {
              declarationPending: response.declarationPending,
              declared: response.declared,
              ...(response.transactionHash ? { transactionHash: response.transactionHash } : {}),
            }
          : "error";
      } catch {
        return "error";
      }
    },
    async loadBalances(multisigId: string): Promise<ScopedBalanceState> {
      const response = await sendMessage({ id: multisigId, type: "wallet.multisigBalances" });
      if (isBalancesResponse(response) && response.accountId === multisigId) {
        return {
          accountId: response.accountId,
          balances: response.balances,
          networkId: response.networkId,
        };
      }
      return {
        error: isErrorResponse(response) ? response.error : "multisig balances unavailable",
      };
    },
    async loadMultisigs(): Promise<Pick<MultisigsResponse, "multisigs" | "proposals"> | "error"> {
      try {
        const response = await sendMessage({ type: "wallet.multisigs" });
        return isMultisigsResponse(response)
          ? { multisigs: response.multisigs, proposals: response.proposals }
          : "error";
      } catch {
        return "error";
      }
    },
    async proposeTransaction(input: {
      readonly calldata: readonly string[];
      readonly entrypoint: string;
      readonly multisigId: string;
      readonly salt: string;
      readonly signerAccountId: string;
      readonly summary: string;
      readonly to: string;
    }): Promise<string> {
      const response = await sendMessage({
        calldata: input.calldata,
        entrypoint: input.entrypoint,
        multisigId: input.multisigId,
        ...(input.salt ? { salt: input.salt } : {}),
        signerAccountId: input.signerAccountId,
        ...(input.summary ? { summary: input.summary } : {}),
        to: input.to,
        type: "wallet.proposeMultisigTx",
      });
      if (isMultisigProposalResponse(response) && response.transactionHash) {
        return response.transactionHash;
      }
      throw responseError(response, "propose failed");
    },
    async refreshMultisig(id: string): Promise<Exclude<MultisigSyncState, null>> {
      let response: unknown;
      try {
        response = await sendMessage({ id, type: "wallet.refreshMultisig" });
      } catch {
        return "background-unavailable";
      }
      if (isMultisigResponse(response)) {
        const warnings = response.warnings ?? [];
        return warnings.includes("proposal-refresh-incomplete")
          ? "proposal-refresh-incomplete"
          : warnings.includes("proposal-discovery-unavailable")
            ? "proposal-discovery-unavailable"
            : warnings.includes("proposal-discovery-recent")
              ? "proposal-discovery-recent"
              : "current";
      }
      return isErrorResponse(response) && response.error === "multisig configuration unavailable"
        ? "configuration-unavailable"
        : "background-unavailable";
    },
    async removeMultisig(id: string): Promise<void> {
      const response = await sendMessage({ id, type: "wallet.removeMultisig" });
      if (!isOkResponse(response)) {
        throw responseError(response, "remove failed");
      }
    },
    async revokeConfirmation(
      proposalId: string,
      signerAccountId: string,
      untrackedVerified?: boolean,
    ): Promise<string> {
      const response = await sendMessage({
        proposalId,
        signerAccountId,
        type: "wallet.revokeMultisigConfirmation",
        ...(untrackedVerified ? { untrackedVerified: true } : {}),
      });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "revoke failed");
    },
    async trackProposal(
      multisigId: string,
      txId: string,
      summary: string,
      call?: MultisigProposalCall,
    ): Promise<void> {
      const response = await sendMessage({
        ...(call ? { call } : {}),
        multisigId,
        ...(summary ? { summary } : {}),
        txId,
        type: "wallet.trackMultisigProposal",
      });
      if (!isMultisigProposalResponse(response)) {
        throw responseError(response, "track failed");
      }
    },
  };
};
