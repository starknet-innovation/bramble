import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "public-portfolio", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances",
};

export default meta;

export const PublicPortfolio = checkpointStory(
  "Disclosure · public portfolio",
  "privacy",
  "public-portfolio",
);
export const Discovering = checkpointStory("Disclosure · discovering", "privacy", "discovering");
export const Unconfigured = checkpointStory("Boundary · unconfigured", "privacy", "unconfigured");
export const LedgerUnsupported = checkpointStory(
  "Boundary · Ledger unsupported",
  "privacy",
  "ledger-unsupported",
);
export const ServiceFailed = checkpointStory(
  "Boundary · service failure",
  "privacy",
  "service-failed",
);
export const ActivationRequired = checkpointStory(
  "Activation · required",
  "privacy",
  "activation-required",
);
export const ActivationReview = checkpointStory(
  "Activation · review",
  "privacy",
  "activation-review",
);
export const Activating = checkpointStory("Activation · working", "privacy", "activating");
export const Activated = checkpointStory("Activation · submitted", "privacy", "activated");
export const PrivatePortfolio = checkpointStory(
  "Disclosure · private portfolio",
  "privacy",
  "private-portfolio",
);
export const RegisteredEmpty = checkpointStory(
  "Disclosure · registered empty",
  "privacy",
  "registered-empty",
);
export const AssetEntry = checkpointStory("Shield · asset entry", "privacy", "asset-entry");
export const ShieldCompose = checkpointStory("Shield · choose amount", "privacy", "shield-compose");
export const ShieldReview = checkpointStory("Shield · review", "privacy", "shield-review");
export const PrivateRelayReview = checkpointStory(
  "Wallet API · private relay review",
  "privacy",
  "private-relay-review",
);
export const Shielding = checkpointStory("Shield · working", "privacy", "shielding");
export const Shielded = checkpointStory("Shield · submitted", "privacy", "shielded");
export const ShieldFailed = checkpointStory("Shield · failure", "privacy", "shield-failed");
