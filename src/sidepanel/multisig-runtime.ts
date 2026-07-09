/**
 * Typed runtime message client for the side panel's multisig screens, kept
 * out of runtime.ts so that file stays within the size budget. Every reply
 * is validated by the multisig response guards before the UI trusts it.
 */
import {
  isMultisigClassStatusResponse,
  isMultisigDeployResponse,
  isMultisigProposalResponse,
  isMultisigResponse,
  isMultisigsResponse,
  isOkResponse,
  type MultisigDeployResponse,
  type MultisigsResponse,
} from "../popup/multisig-responses";
import { isErrorResponse, isTransferResponse } from "../popup/responses";
import type { RuntimeApi } from "./runtime";

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
    async confirmProposal(proposalId: string, untrackedVerified?: boolean): Promise<string> {
      const response = await sendMessage({
        proposalId,
        type: "wallet.confirmMultisigProposal",
        ...(untrackedVerified ? { untrackedVerified: true } : {}),
      });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "confirm failed");
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
    async executeProposal(proposalId: string): Promise<string> {
      const response = await sendMessage({ proposalId, type: "wallet.executeMultisigProposal" });
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
    async loadClassStatus(): Promise<boolean | "error"> {
      try {
        const response = await sendMessage({ type: "wallet.multisigClassStatus" });
        return isMultisigClassStatusResponse(response) ? response.declared : "error";
      } catch {
        return "error";
      }
    },
    async loadMultisigs(): Promise<Pick<MultisigsResponse, "multisigs" | "proposals">> {
      const response = await sendMessage({ type: "wallet.multisigs" });
      return isMultisigsResponse(response)
        ? { multisigs: response.multisigs, proposals: response.proposals }
        : { multisigs: [], proposals: [] };
    },
    async proposeTransaction(input: {
      readonly calldata: readonly string[];
      readonly entrypoint: string;
      readonly multisigId: string;
      readonly salt: string;
      readonly summary: string;
      readonly to: string;
    }): Promise<string> {
      const response = await sendMessage({
        calldata: input.calldata,
        entrypoint: input.entrypoint,
        multisigId: input.multisigId,
        ...(input.salt ? { salt: input.salt } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
        to: input.to,
        type: "wallet.proposeMultisigTx",
      });
      if (isMultisigProposalResponse(response) && response.transactionHash) {
        return response.transactionHash;
      }
      throw responseError(response, "propose failed");
    },
    async refreshMultisig(id: string): Promise<void> {
      const response = await sendMessage({ id, type: "wallet.refreshMultisig" });
      if (!isMultisigResponse(response)) {
        throw responseError(response, "refresh failed");
      }
    },
    async removeMultisig(id: string): Promise<void> {
      const response = await sendMessage({ id, type: "wallet.removeMultisig" });
      if (!isOkResponse(response)) {
        throw responseError(response, "remove failed");
      }
    },
    async revokeConfirmation(proposalId: string, untrackedVerified?: boolean): Promise<string> {
      const response = await sendMessage({
        proposalId,
        type: "wallet.revokeMultisigConfirmation",
        ...(untrackedVerified ? { untrackedVerified: true } : {}),
      });
      if (isTransferResponse(response)) {
        return response.transactionHash;
      }
      throw responseError(response, "revoke failed");
    },
    async trackProposal(multisigId: string, txId: string, summary: string): Promise<void> {
      const response = await sendMessage({
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
