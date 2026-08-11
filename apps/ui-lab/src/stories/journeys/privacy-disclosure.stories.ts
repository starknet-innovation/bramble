import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "public-portfolio", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/01 Disclosure",
};

export default meta;

export const PublicPortfolio = checkpointStory("Public portfolio", "privacy", "public-portfolio");
export const Discovering = checkpointStory("Discovering balances", "privacy", "discovering");
export const PrivatePortfolio = checkpointStory(
  "Private portfolio",
  "privacy",
  "private-portfolio",
);
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
