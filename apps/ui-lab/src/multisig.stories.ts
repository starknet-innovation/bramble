import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "list", scenarioId: "multisig" },
  title: "Wallet journeys/08 Multisig",
};

export default meta;

export const Watched = checkpointStory("Watched multisigs", "multisig", "list");
export const Watch = checkpointStory("Watch multisig", "multisig", "watch");
export const Proposal = checkpointStory("Proposal detail", "multisig", "proposal");
export const Collectibles = checkpointStory("Shared collectibles", "multisig", "collectibles");
export const AccountDrawer = checkpointStory("Shared account drawer", "multisig", "drawer");
export const IndependentReview = checkpointStory(
  "Independent review",
  "multisig",
  "independent-review",
);
export const Receive = checkpointStory("Receive to shared account", "multisig", "receive");
export const Signers = checkpointStory("Signers and quorum", "multisig", "signers");
export const Track = checkpointStory("Track shared proposal", "multisig", "track");
export const Ready = checkpointStory("Ready to execute", "multisig", "ready");
export const ReadyProposal = checkpointStory("Ready proposal detail", "multisig", "ready-proposal");
export const SyncFailure = checkpointStory("Refresh failed", "multisig", "sync-error");
export const Propose = checkpointStory("Create proposal", "multisig", "propose");
export const ProposeAmount = checkpointStory(
  "Create proposal · token and amount",
  "multisig",
  "propose-amount",
);
export const ProposeReview = checkpointStory(
  "Create proposal · review",
  "multisig",
  "propose-review",
);
export const ProposeAdvanced = checkpointStory(
  "Create proposal · advanced",
  "multisig",
  "propose-advanced",
);
export const DeployChecking = checkpointStory(
  "Deploy · class checking",
  "multisig",
  "deploy-checking",
);
export const DeployDeclare = checkpointStory(
  "Deploy · declare first",
  "multisig",
  "deploy-declare",
);
export const DeployReady = checkpointStory("Deploy · ready", "multisig", "deploy-ready");
export const DeployRules = checkpointStory("Deploy · rules", "multisig", "deploy-rules");
export const Untracked = checkpointStory("Shared proposal", "multisig", "shared-untracked");
export const Executed = checkpointStory("Executed proposal", "multisig", "executed");
