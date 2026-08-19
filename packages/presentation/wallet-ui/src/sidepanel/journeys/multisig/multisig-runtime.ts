/** Validated runtime client for privileged Argent multisig operations. */
import type { ArgentMultisigCall } from "@mc-wallet/multisig/chain";
import type { ArgentMultisigSigningIntent } from "@mc-wallet/multisig/repository";
import type { FeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import {
  type ArgentMultisigDeploymentReview,
  type ArgentMultisigIntentPackage,
  type ArgentMultisigView,
  isArgentMultisigClassStatusResponse,
  isArgentMultisigDeploymentReviewResponse,
  isArgentMultisigDeployResponse,
  isArgentMultisigIntentResponse,
  isArgentMultisigResponse,
  isArgentMultisigsResponse,
  isOkResponse,
} from "../../../popup/responses/multisig-responses";
import { isBalancesResponse, isErrorResponse } from "../../../popup/responses/responses";
import type { RuntimeApi, ScopedBalanceState } from "../../runtime/runtime";
import { responseError } from "../../runtime/runtime-errors";

/**
 * Address and active network required to sync an existing Argent multisig.
 */
export type ArgentMultisigSetup = {
  readonly address: string;
  readonly networkId: string;
  readonly signerPublicKeys?: readonly string[];
};

/**
 * Constructor authority required to review a new Argent multisig deployment.
 */
export type ArgentMultisigDeploymentSetup = {
  readonly expectedAddress?: string;
  readonly name?: string;
  readonly networkId: string;
  readonly salt: string;
  readonly signerAccountId: string;
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
};

/**
 * Frozen intent plus its exportable package and optional fee/hash result.
 */
export type ArgentMultisigIntentResult = {
  readonly feeReview?: FeeEstimate;
  readonly intent: ArgentMultisigSigningIntent;
  readonly intentPackage?: ArgentMultisigIntentPackage;
  readonly transactionHash?: string;
};

/**
 * Client surface returned by {@link createMultisigClient}.
 */
export type MultisigClient = ReturnType<typeof createMultisigClient>;

/**
 * Creates a runtime client that rejects every malformed background response.
 */
export const createMultisigClient = (runtime?: RuntimeApi) => {
  const sendMessage = async (message: unknown): Promise<unknown> => runtime?.sendMessage(message);
  const intentResult = async (
    message: unknown,
    fallback: string,
  ): Promise<ArgentMultisigIntentResult> => {
    const response = await sendMessage(message);
    if (!isArgentMultisigIntentResponse(response)) {
      throw responseError(response, fallback);
    }
    return {
      ...(response.feeReview ? { feeReview: response.feeReview } : {}),
      intent: response.intent,
      ...(response.intentPackage ? { intentPackage: response.intentPackage } : {}),
      ...(response.transactionHash ? { transactionHash: response.transactionHash } : {}),
    };
  };

  return {
    async addMultisig(input: ArgentMultisigSetup): Promise<ArgentMultisigView> {
      const response = await sendMessage({ ...input, type: "wallet.addMultisig" });
      if (!isArgentMultisigResponse(response)) {
        throw responseError(response, "add Argent multisig failed");
      }
      return response.multisig;
    },
    async deployMultisig(review: ArgentMultisigDeploymentReview) {
      const response = await sendMessage({ review, type: "wallet.deployArgentMultisig" });
      if (!isArgentMultisigDeployResponse(response)) {
        throw responseError(response, "deploy Argent multisig failed");
      }
      return response;
    },
    async importIntent(intentPackage: ArgentMultisigIntentPackage) {
      return intentResult(
        { package: intentPackage, type: "wallet.importArgentMultisigIntent" },
        "import Argent multisig intent failed",
      );
    },
    async importSignature(intentId: string, signature: StarkSignature) {
      return intentResult(
        { intentId, signature, type: "wallet.importArgentMultisigSignature" },
        "import Argent multisig signature failed",
      );
    },
    async loadBalances(multisigId: string): Promise<ScopedBalanceState> {
      const response = await sendMessage({ multisigId, type: "wallet.multisigBalances" });
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
    async loadClassStatus(): Promise<boolean | "error"> {
      try {
        const response = await sendMessage({ type: "wallet.argentMultisigClassStatus" });
        return isArgentMultisigClassStatusResponse(response) ? response.declared : "error";
      } catch {
        return "error";
      }
    },
    async loadMultisigs(): Promise<
      | {
          readonly intents: readonly ArgentMultisigSigningIntent[];
          readonly multisigs: readonly ArgentMultisigView[];
        }
      | "error"
    > {
      try {
        const response = await sendMessage({ type: "wallet.multisigs" });
        return isArgentMultisigsResponse(response)
          ? { intents: response.intents, multisigs: response.multisigs }
          : "error";
      } catch {
        return "error";
      }
    },
    async prepareIntent(multisigId: string, calls: readonly ArgentMultisigCall[]) {
      return intentResult(
        { calls, multisigId, type: "wallet.prepareArgentMultisigIntent" },
        "prepare Argent multisig intent failed",
      );
    },
    async refreshMultisig(multisigId: string): Promise<
      | {
          readonly intents: readonly ArgentMultisigSigningIntent[];
          readonly multisig: ArgentMultisigView;
        }
      | "error"
    > {
      try {
        const response = await sendMessage({ multisigId, type: "wallet.refreshMultisig" });
        return isArgentMultisigResponse(response)
          ? { intents: response.intents, multisig: response.multisig }
          : "error";
      } catch {
        return "error";
      }
    },
    async removeMultisig(multisigId: string, confirmHistoryRemoval = false): Promise<void> {
      const response = await sendMessage({
        ...(confirmHistoryRemoval ? { confirmHistoryRemoval: true } : {}),
        multisigId,
        type: "wallet.removeMultisig",
      });
      if (!isOkResponse(response)) {
        throw responseError(response, "remove Argent multisig failed");
      }
    },
    async reviewDeployment(
      input: ArgentMultisigDeploymentSetup,
    ): Promise<ArgentMultisigDeploymentReview> {
      const response = await sendMessage({
        ...input,
        type: "wallet.reviewArgentMultisigDeployment",
      });
      if (!isArgentMultisigDeploymentReviewResponse(response)) {
        throw responseError(response, "review Argent multisig deployment failed");
      }
      return response.deploymentReview;
    },
    async signIntent(intentId: string, signerAccountId: string) {
      return intentResult(
        { intentId, signerAccountId, type: "wallet.signArgentMultisigIntent" },
        "sign Argent multisig intent failed",
      );
    },
    async submitIntent(intentId: string) {
      return intentResult(
        { intentId, type: "wallet.submitArgentMultisigIntent" },
        "submit Argent multisig intent failed",
      );
    },
  };
};
