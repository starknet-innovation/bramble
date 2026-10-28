/** Validated runtime client for privileged Argent multisig operations. */
import type { ArgentMultisigCall } from "@bramble/multisig/chain";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import {
  type ArgentMultisigDeploymentReview,
  type ArgentMultisigIntentPackage,
  type ArgentMultisigView,
  isArgentMultisigClassStatusResponse,
  isArgentMultisigDeploymentReviewResponse,
  isArgentMultisigDeployResponse,
  isArgentMultisigIntentResponse,
  isMultisigSignerResponse,
  isNostrShareResponse,
  isNostrSyncResponse,
  isOkResponse,
  type MultisigSignerAccount,
  readArgentMultisig,
  readArgentMultisigs,
} from "../../../popup/responses/multisig-responses";
import { isBalancesResponse } from "../../../popup/responses/responses";
import type { RuntimeApi, ScopedBalanceState } from "../../runtime/runtime";
import { lostReplySend, refusalText, responseError } from "../../runtime/runtime-errors";

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
  const sendMessage = lostReplySend(runtime);
  type RefreshResult =
    | {
        readonly intents: readonly ArgentMultisigSigningIntent[];
        readonly multisig: ArgentMultisigView;
      }
    | "error";
  const refreshes = new Map<string, Promise<RefreshResult>>();
  const invalidateRefreshes = (): void => refreshes.clear();
  const intentResult = async (
    message: unknown,
    fallback: string,
  ): Promise<ArgentMultisigIntentResult> => {
    // Transaction boundaries still force a fresh background authority check.
    invalidateRefreshes();
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
      invalidateRefreshes();
      const response = await sendMessage({ ...input, type: "wallet.addMultisig" });
      const added = readArgentMultisig(response);
      if (!added) {
        throw responseError(response, "add Ready multisig failed");
      }
      return added.multisig;
    },
    async deployMultisig(review: ArgentMultisigDeploymentReview) {
      invalidateRefreshes();
      const response = await sendMessage({ review, type: "wallet.deployArgentMultisig" });
      if (!isArgentMultisigDeployResponse(response)) {
        throw responseError(response, "deploy Ready multisig failed");
      }
      return response;
    },
    async importIntent(intentPackage: ArgentMultisigIntentPackage) {
      return intentResult(
        { package: intentPackage, type: "wallet.importArgentMultisigIntent" },
        "import Ready multisig intent failed",
      );
    },
    async importSignature(intentId: string, signature: StarkSignature) {
      return intentResult(
        { intentId, signature, type: "wallet.importArgentMultisigSignature" },
        "import Ready multisig signature failed",
      );
    },
    async loadBalances(
      multisigId: string,
      cached = false,
      refresh = false,
    ): Promise<ScopedBalanceState> {
      const response = await sendMessage({
        ...(cached ? { cached: true } : {}),
        ...(refresh ? { refresh: true } : {}),
        multisigId,
        type: "wallet.multisigBalances",
      });
      if (isBalancesResponse(response) && response.accountId === multisigId) {
        return {
          accountId: response.accountId,
          ...(response.asOf === undefined ? {} : { asOf: response.asOf }),
          balances: response.balances,
          networkId: response.networkId,
          ...(response.stale === undefined ? {} : { stale: response.stale }),
        };
      }
      return { error: refusalText(response, "multisig balances unavailable") };
    },
    async loadClassStatus(): Promise<boolean | "error"> {
      try {
        const response = await sendMessage({ type: "wallet.argentMultisigClassStatus" });
        return isArgentMultisigClassStatusResponse(response) ? response.declared : "error";
      } catch {
        return "error";
      }
    },
    async loadMultisigs(cached = false): Promise<
      | {
          readonly intents: readonly ArgentMultisigSigningIntent[];
          readonly multisigs: readonly ArgentMultisigView[];
        }
      | "error"
    > {
      try {
        const response = await sendMessage({
          ...(cached ? { cached: true } : {}),
          type: "wallet.multisigs",
        });
        return readArgentMultisigs(response) ?? "error";
      } catch {
        return "error";
      }
    },
    async prepareIntent(
      multisigId: string,
      calls: readonly ArgentMultisigCall[],
      confirmResend = false,
    ) {
      return intentResult(
        {
          calls,
          ...(confirmResend ? { confirmResend: true } : {}),
          multisigId,
          type: "wallet.prepareArgentMultisigIntent",
        },
        "prepare Ready multisig intent failed",
      );
    },
    async resolveSigner(address: string, networkId: string): Promise<MultisigSignerAccount> {
      const response = await sendMessage({
        address,
        networkId,
        type: "wallet.resolveMultisigSigner",
      });
      if (!isMultisigSignerResponse(response)) {
        throw responseError(response, "resolve multisig signer account failed");
      }
      return response.signer;
    },
    async refreshMultisig(multisigId: string, force = false): Promise<RefreshResult> {
      if (force) refreshes.delete(multisigId);
      const existing = refreshes.get(multisigId);
      if (existing) return existing;
      const refresh = sendMessage({ multisigId, type: "wallet.refreshMultisig" })
        .then((response): RefreshResult => readArgentMultisig(response) ?? "error")
        .catch((): RefreshResult => "error");
      refreshes.set(multisigId, refresh);
      // A successful confirmed authority is stable until a multisig action.
      // Failed reads remain retryable when the network recovers.
      void refresh.then((result) => {
        if (
          (result === "error" || result.multisig.authorityStatus === "network-unavailable") &&
          refreshes.get(multisigId) === refresh
        ) {
          refreshes.delete(multisigId);
        }
      });
      return refresh;
    },
    async removeMultisig(multisigId: string, confirmHistoryRemoval = false): Promise<void> {
      invalidateRefreshes();
      const response = await sendMessage({
        ...(confirmHistoryRemoval ? { confirmHistoryRemoval: true } : {}),
        multisigId,
        type: "wallet.removeMultisig",
      });
      if (!isOkResponse(response)) {
        throw responseError(response, "remove Ready multisig failed");
      }
    },
    async removeIntent(intentId: string): Promise<void> {
      invalidateRefreshes();
      const response = await sendMessage({ intentId, type: "wallet.removeArgentMultisigIntent" });
      if (!isOkResponse(response)) {
        throw responseError(response, "remove Ready multisig intent failed");
      }
    },
    async reviewDeployment(
      input: ArgentMultisigDeploymentSetup,
    ): Promise<ArgentMultisigDeploymentReview> {
      invalidateRefreshes();
      const response = await sendMessage({
        ...input,
        type: "wallet.reviewArgentMultisigDeployment",
      });
      if (!isArgentMultisigDeploymentReviewResponse(response)) {
        throw responseError(response, "review Ready multisig deployment failed");
      }
      return response.deploymentReview;
    },
    async signIntent(intentId: string, signerAccountId: string) {
      return intentResult(
        { intentId, signerAccountId, type: "wallet.signArgentMultisigIntent" },
        "sign Ready multisig intent failed",
      );
    },
    async shareIntent(
      intentId: string,
    ): Promise<{ readonly recipients: number; readonly totalRecipients: number }> {
      const response = await sendMessage({
        intentId,
        type: "wallet.shareArgentMultisigIntent",
      });
      if (!isNostrShareResponse(response)) {
        throw responseError(response, "secure co-signer share failed");
      }
      return { recipients: response.recipients, totalRecipients: response.totalRecipients };
    },
    async syncIntents(multisigId: string): Promise<{
      readonly imported: number;
      readonly intentIds: readonly string[];
      readonly received: number;
    }> {
      invalidateRefreshes();
      const response = await sendMessage({ multisigId, type: "wallet.syncArgentMultisigIntents" });
      if (!isNostrSyncResponse(response)) {
        throw responseError(response, "co-signer sync failed");
      }
      return {
        imported: response.imported,
        intentIds: response.intentIds,
        received: response.received,
      };
    },
    async submitIntent(intentId: string) {
      return intentResult(
        { intentId, type: "wallet.submitArgentMultisigIntent" },
        "submit Ready multisig intent failed",
      );
    },
  };
};
