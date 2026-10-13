/**
 * The broadcast half of an NFT send: submit under the reviewed fee, then file
 * the activity line. Same outcome rules as the token send (wallet-ops.ts):
 * once a hash exists the reply carries it, and a broadcast whose reply was
 * lost is answered as status unknown, with the signed hash recorded as a
 * pending Activity row so it can be followed (audit #173, errors audit F1).
 *
 * Trust boundary: the call, account, and fee come from the caller's verified
 * preparation; nothing here re-validates them. Failure behaviour: a refusal
 * before or at submission is rethrown for the router; bookkeeping failures
 * after a hash exists are absorbed.
 */
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import type { Call } from "starknet";
import { signerForContext, type WalletOpsDeps } from "../accounts/wallet-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";

/** The verified NFT send the submission carries out. */
export type NftTransferSubmission = {
  readonly call: Call;
  readonly context: Parameters<typeof signerForContext>[1] & {
    readonly account: AccountRef;
    readonly networkId: StarknetNetworkId;
  };
  readonly isAuthorized: () => boolean;
  readonly recipient: string;
  readonly reviewedDeploymentFee?: FeeEstimate;
  readonly reviewedFee: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly summary: string;
};

/**
 * Submits a verified NFT send. Returns the accepted hash, or a status-unknown
 * reply (with the signed hash when one was captured) for a lost broadcast.
 */
export const submitNftTransfer = async (
  deps: WalletOpsDeps,
  input: NftTransferSubmission,
): Promise<RuntimeResponse> => {
  const { context } = input;
  const activityFor = (hash: string) => ({
    accountId: context.account.id,
    // The NFT's recipient is a payee like an ERC20 send's (audit #163).
    counterparty: input.recipient,
    hash,
    kind: "invoke" as const,
    networkId: context.networkId,
    summary: input.summary,
  });
  // The hash of the invoke as signed, captured before it is sent. Only used
  // when the reply is lost, so the send stays traceable.
  let signedHash: string | undefined;
  let transactionHash: string;
  try {
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account: context.account,
      calls: [input.call],
      isAuthorized: input.isAuthorized,
      onSigned: async (signed) => {
        signedHash = signed.transactionHash;
      },
      ...(input.reviewedDeploymentFee
        ? { reviewedDeploymentFee: input.reviewedDeploymentFee }
        : {}),
      reviewedFee: input.reviewedFee,
      rpcUrls: input.rpcUrls,
      signHash: signerForContext(deps, context),
    });
    transactionHash = result.transactionHash;
  } catch (error) {
    if (!(error instanceof IndeterminateRpcWriteError)) {
      throw error;
    }
    // The send may already be on chain: record it as pending so Activity and
    // the reconciler can follow it, and never invite a blind re-send.
    const pending = signedHash;
    if (pending !== undefined) {
      await afterBroadcast(() => recordSubmittedActivity(deps.activity, activityFor(pending)));
    }
    return submissionUnknownResponse(error.message, signedHash);
  }
  await afterBroadcast(async () => {
    await recordSubmittedActivity(deps.activity, activityFor(transactionHash));
    await deps.nftSnapshots?.clear(context.account.id, context.networkId).catch(() => undefined);
  });
  return { ok: true, transactionHash };
};
