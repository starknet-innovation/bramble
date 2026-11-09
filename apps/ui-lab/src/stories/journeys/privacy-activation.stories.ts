import { expect } from "storybook/test";
import {
  assertCheckpointReady,
  checkpointStory,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "activation-required", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/02 Activation",
};

export default meta;

export const Required = checkpointStory("Activation required", "privacy", "activation-required");
export const FeeFailed = checkpointStory("Fee estimate failed", "privacy", "activation-fee-failed");
export const Review = checkpointStory("Review activation", "privacy", "activation-review");
export const Proving = checkpointStory("Proof and authorization", "privacy", "activating");
export const Submitted = checkpointStory("Activation submitted", "privacy", "activated");
// Registration is the only journey left on this surface, so its failure state
// belongs here rather than beside the shielding entry point.
export const Failed = checkpointStory("Recover from failure", "privacy", "activation-failed");
// A lost submission reply: amber, not the red failure, and no blind retry.
export const StatusUnknown = checkpointStory("Status unknown", "privacy", "activation-unknown");

// The refusal names the missing STRK but not the amount, so the fund screen
// states the pool fee the registration needs. The play pins the exact figure, so
// a fixture or template drift that drops the number fails here rather than only
// in a manual browser pass.
export const FundBlocked: LabStory = {
  args: { checkpointId: "fund-blocked", scenarioId: "privacy" },
  name: "Registration needs funds",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const blocked =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(blocked?.querySelector('[data-privacy-blocker="fund"]')).toHaveTextContent(
      "Registration needs 6 STRK for the pool fee, plus a network fee.",
    );
  },
};

export const FundBlockedLong = checkpointStory(
  "Registration fee at its ceiling",
  "privacy",
  "fund-blocked-long",
);
