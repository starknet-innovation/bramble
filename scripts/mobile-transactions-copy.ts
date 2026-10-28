/**
 * The Send journey's copy for the mobile fixture, read from the extension modules that export it
 * (stage titles, the mode table, fee lines, review blocks, working screens, refusals).
 */
import {
  REVIEWED_DEPLOYMENT_FEE_EXCEEDED,
  REVIEWED_DEPLOYMENT_FEE_REQUIRED,
} from "@bramble/starknet/deployment";
import { INDETERMINATE_RPC_WRITE_MESSAGE } from "@bramble/starknet/provider";
import { buildErc20TransferCall, parseTokenAmount } from "@bramble/starknet/rpc";
import { REVIEWED_FEE_EXCEEDED, REVIEWED_FEE_REQUIRED } from "@bramble/starknet/rpc-submit";
import { verifyCalls } from "@bramble/transactions/verify";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
import {
  transferModeCopy,
  transferStageTitle,
  transferSuccessSummary,
} from "../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-mode";
import {
  initialTransferState,
  recipientFieldError,
} from "../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-model";
import { workingStatus } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-progress-ui";
import { reviewedState } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-submit";
import { confirmationOutcome } from "../packages/presentation/wallet-ui/src/sidepanel/shared/confirm-submitted";
import { reviewFeeSection } from "../packages/presentation/wallet-ui/src/sidepanel/shared/review-render";

const MAINNET_ACCOUNT = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";
const LOOKALIKE = "0x2083610000000000000000000000000000000000000000000000000000098d9";

const errorText = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const stripTags = (html: string): string[] =>
  html
    .split(/<[^>]+>/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);

/** Every send-journey string the mobile screens show, read from the modules that export it. */
export const computeCopyVectors = () => {
  const fee = { overallFee: "8053560001244160", unit: "FRI" } as const;
  const deploymentFee = { overallFee: "5000000000000000", unit: "FRI" } as const;
  const reviewBase = {
    fee,
    feeAffordability: "unknown",
    feeEstimateFailed: false,
    flags: [],
    requiresDeployment: false,
    summaries: [],
  };
  const stages = [
    "recipient",
    "details",
    "reviewing",
    "review",
    "authorizing",
    "broadcasting",
    "confirming",
    "pending",
    "submitted",
    "failed",
  ] as const;
  return {
    confirmationOutcomes: (
      ["accepted", "preconfirmed", "rejected", "reverted", "pending"] as const
    ).map((status) => ({ outcome: confirmationOutcome(status), status })),
    mode: transferModeCopy("send"),
    amountErrors: {
      invalid: errorText(() => parseTokenAmount("", 18)),
      notPositive: errorText(() => parseTokenAmount("0", 18)),
      tooManyDecimals: errorText(() => parseTokenAmount("0.1", 0)),
    },
    refusals: {
      selfTransfer:
        verifyCalls(
          [buildErc20TransferCall(DEFAULT_TOKENS[0]?.address ?? "", MAINNET_ACCOUNT, 1n)],
          {
            account: { address: MAINNET_ACCOUNT, networkId: "SN_MAIN" } as never,
            addressBook: [],
            tokens: [],
          },
        ).flags.find((flag) => flag.code === "self-transfer")?.message ?? null,
      poisonedRecipient:
        verifyCalls([buildErc20TransferCall(DEFAULT_TOKENS[0]?.address ?? "", LOOKALIKE, 1n)], {
          account: { address: MAINNET_ACCOUNT, networkId: "SN_MAIN" } as never,
          addressBook: [],
          tokens: [],
        }).flags.find((flag) => flag.code === "address-poisoning")?.message ?? null,
      indeterminateWrite: INDETERMINATE_RPC_WRITE_MESSAGE,
      invalidRecipient: recipientFieldError("not an address"),
      reviewedDeploymentFeeExceeded: REVIEWED_DEPLOYMENT_FEE_EXCEEDED,
      reviewedDeploymentFeeRequired: REVIEWED_DEPLOYMENT_FEE_REQUIRED,
      reviewedFeeExceeded: REVIEWED_FEE_EXCEEDED,
      reviewedFeeRequired: REVIEWED_FEE_REQUIRED,
    },
    reviewFee: {
      deployedFailed: stripTags(reviewFeeSection({ fee: null, feeEstimateFailed: true }, {})),
      deployedKnown: stripTags(reviewFeeSection({ fee }, {})),
      undeployedFailed: stripTags(
        reviewFeeSection(
          {
            deploymentFeeEstimateFailed: true,
            fee: null,
            feeEstimateFailed: true,
            requiresDeployment: true,
          },
          {},
        ),
      ),
      undeployedKnown: stripTags(
        reviewFeeSection({ deploymentFee, fee, requiresDeployment: true }, {}),
      ),
    },
    reviewBlocks: {
      feeUnavailable: reviewedState(
        { ...reviewBase, feeEstimateFailed: true } as never,
        null as never,
        "key",
      ).error,
      poisoned: reviewedState(
        {
          ...reviewBase,
          flags: [{ code: "address-poisoning", message: "" }],
        } as never,
        null as never,
        "key",
      ).error,
    },
    stageTitles: stages.map((stage) => ({ stage, title: transferStageTitle(stage) })),
    working: {
      authorizing: workingStatus({ ...initialTransferState(), stage: "authorizing" }),
      broadcasting: workingStatus({
        ...initialTransferState(),
        progress: { elapsedMs: 0, phase: "broadcasting" } as never,
        stage: "authorizing",
      }),
      confirming: workingStatus({ ...initialTransferState(), stage: "confirming" }),
    },
    successSummary: transferSuccessSummary("send", "1.5", "STRK", "0x3fa7…41a3"),
  };
};
