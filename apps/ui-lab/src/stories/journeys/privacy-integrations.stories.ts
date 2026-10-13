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
export const ShadowAccountIdentity = checkpointStory(
  "Share scoped identity",
  "privacy",
  "shadow-account-identity",
);
export const ShadowAccountInvoke = checkpointStory(
  "Review shadow-account action",
  "privacy",
  "shadow-account-invoke",
);
export const ShadowAccountParameters = checkpointStory(
  "Inspect shadow-account parameters",
  "privacy",
  "shadow-account-parameters",
);
