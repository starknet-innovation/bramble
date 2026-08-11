import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "anonymizer-review", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/05 Dapp integrations",
};

export default meta;

export const DappAnonymizer = checkpointStory(
  "Review dapp anonymizer",
  "privacy",
  "anonymizer-review",
);
export const DappAnonymizerParameters = checkpointStory(
  "Inspect anonymizer parameters",
  "privacy",
  "anonymizer-parameters",
);
export const PrivateSwapReview = checkpointStory(
  "Review AVNU private swap",
  "privacy",
  "private-swap-review",
);
export const PrivateSwapParameters = checkpointStory(
  "Inspect AVNU private swap route",
  "privacy",
  "private-swap-parameters",
);
export const PrivateSwapProcessing = checkpointStory(
  "Prepare private swap proof",
  "privacy",
  "private-swap-processing",
);
export const SubaccountIdentity = checkpointStory(
  "Share scoped identity",
  "privacy",
  "subaccount-identity",
);
export const SubaccountInvoke = checkpointStory(
  "Review sub-account action",
  "privacy",
  "subaccount-invoke",
);
export const SubaccountParameters = checkpointStory(
  "Inspect sub-account parameters",
  "privacy",
  "subaccount-parameters",
);
