import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "activation-required", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/02 Activation",
};

export default meta;

export const Required = checkpointStory("Activation required", "privacy", "activation-required");
export const Review = checkpointStory("Review activation", "privacy", "activation-review");
export const Proving = checkpointStory("Proof and authorization", "privacy", "activating");
export const Submitted = checkpointStory("Activation submitted", "privacy", "activated");
// Registration is the only journey left on this surface, so its failure state
// belongs here rather than beside the shielding entry point.
export const Failed = checkpointStory("Recover from failure", "privacy", "activation-failed");
// A lost submission reply: amber, not the red failure, and no blind retry.
export const StatusUnknown = checkpointStory("Status unknown", "privacy", "activation-unknown");
