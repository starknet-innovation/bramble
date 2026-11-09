import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "balance-selective", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/04 Private actions",
};

export default meta;

export const ShareSelectedBalances = checkpointStory(
  "Share selected balances",
  "privacy",
  "balance-selective",
);
export const ShareEveryBalance = checkpointStory("Share every balance", "privacy", "balance-all");
export const RegisterActivation = checkpointStory(
  "Review dapp registration",
  "privacy",
  "register-activation",
);
export const PrepareTransfer = checkpointStory(
  "Prepare a private transfer",
  "privacy",
  "proof-transfer",
);
export const TransferReview = checkpointStory(
  "Review private transfer",
  "privacy",
  "transfer-review",
);
export const TransferParameters = checkpointStory(
  "Inspect transfer parameters",
  "privacy",
  "transfer-parameters",
);
export const TransferProcessing = checkpointStory(
  "Authorize private transfer",
  "privacy",
  "transfer-processing",
);
export const WithdrawalReview = checkpointStory(
  "Review public withdrawal",
  "privacy",
  "withdrawal-review",
);
export const LockedRequest = checkpointStory(
  "Unlock before private access",
  "privacy",
  "locked-request",
);
