import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "method", scenarioId: "mobile-pq-onboarding" },
  title: "Wallet journeys/07 Post-quantum phone",
};

export default meta;

export const ChooseMethod = checkpointStory(
  "Add account · choose method",
  "mobile-pq-onboarding",
  "method",
);
export const EnrollChallenge = checkpointStory(
  "Add account · awaiting challenge",
  "mobile-pq-onboarding",
  "loading",
);
export const EnrollCollect = checkpointStory(
  "Add account · prove possession",
  "mobile-pq-onboarding",
  "collect",
);
export const EnrollVerifying = checkpointStory(
  "Add account · verifying device",
  "mobile-pq-onboarding",
  "enrolling",
);
export const EnrollMalformed = checkpointStory(
  "Add account · malformed key",
  "mobile-pq-onboarding",
  "malformed",
);
export const EnrollRefused = checkpointStory(
  "Add account · refused enrollment",
  "mobile-pq-onboarding",
  "refused",
);

export const Handoff = checkpointStory("Signing · handoff", "mobile-pq-sign", "handoff");
export const Verifying = checkpointStory("Signing · verifying", "mobile-pq-sign", "submitting");
export const Refused = checkpointStory("Signing · refused", "mobile-pq-sign", "error");
