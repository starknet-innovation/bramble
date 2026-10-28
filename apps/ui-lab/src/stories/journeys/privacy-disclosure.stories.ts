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
  args: { checkpointId: "public-portfolio", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/01 Disclosure",
};

export default meta;

export const PublicPortfolio = checkpointStory("Public portfolio", "privacy", "public-portfolio");
export const Discovering = checkpointStory("Discovering balances", "privacy", "discovering");
// A token held partly in private shows its split on the collapsed row, so the
// reader need not expand it to see what is shielded (issue 664).
export const PrivatePortfolio: LabStory = {
  args: { checkpointId: "private-portfolio", scenarioId: "privacy" },
  name: "Private portfolio",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    const split = body?.querySelector(".token-unified summary .token-split");
    await expect(split).toHaveTextContent("1.25 public · 0.50 private");
  },
};
export const RegisteredEmpty = checkpointStory(
  "Registered with no notes",
  "privacy",
  "registered-empty",
);
export const Unconfigured = checkpointStory("Network not configured", "privacy", "unconfigured");
export const ServiceFailed = checkpointStory(
  "Discovery service failure",
  "privacy",
  "service-failed",
);
export const LedgerUnsupported = checkpointStory(
  "Ledger unsupported",
  "privacy",
  "ledger-unsupported",
);
