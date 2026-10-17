/**
 * The reply to a dapp invoke whose submission failed. Split from
 * `provider-ops.ts` by behaviour: what a failure may say, and what it must
 * still record.
 */
import { walletErrorMessage } from "@bramble/core/errors";
import { mapStrk20StageError } from "@bramble/privacy/official-sdk-errors";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { afterBroadcast } from "../transactions/activity-recording";

const invokeFailureMessage = (error: unknown, hasProof: boolean): string => {
  if (!hasProof) {
    return walletErrorMessage(error, "invoke request failed");
  }
  try {
    mapStrk20StageError("submission", error);
  } catch (mapped) {
    return walletErrorMessage(mapped, "invoke request failed");
  }
  return "invoke request failed";
};

/**
 * Maps a failed dapp invoke to its reply. An accepted automatic deployment the
 * failure carries is recorded first, whatever the reply, because its fee is
 * spent (mc-wallet 719). A lost public-lane reply may be on chain, so it
 * records a pending row and answers with the typed unknown (audit M4); any
 * other failure is a reviewed error. Recording never changes the reply.
 */
export const invokeFailureResponse = async (
  error: unknown,
  hasProof: boolean,
  signedHash: string | undefined,
  recordPending: (hash: string) => Promise<void>,
  recordDeployment: (source: unknown) => Promise<void>,
): Promise<RuntimeResponse> => {
  await afterBroadcast(() => recordDeployment(error));
  if (!(error instanceof IndeterminateRpcWriteError) || hasProof) {
    return { error: invokeFailureMessage(error, hasProof) };
  }
  if (signedHash !== undefined) await afterBroadcast(() => recordPending(signedHash));
  return submissionUnknownResponse(error.message, signedHash);
};
