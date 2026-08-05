import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "list", scenarioId: "multisig" },
  title: "Wallet journeys/09 Multisig",
};

export default meta;

export const AddAccount = checkpointStory("Add a Multisig account", "multisig", "add");
export const Watched = checkpointStory("Watched multisigs", "multisig", "list");
export const Watch = checkpointStory("Watch multisig", "multisig", "watch");
export const Proposal = checkpointStory("Proposal detail", "multisig", "proposal");
export const ProposalSearch = checkpointStory(
  "Recent proposal search",
  "multisig",
  "proposal-search-recent",
);
export const SharedActivity = checkpointStory(
  "Shared account activity",
  "multisig",
  "shared-activity",
);
export const Collectibles = checkpointStory("Shared collectibles", "multisig", "collectibles");
export const AccountDrawer = checkpointStory("Shared account drawer", "multisig", "drawer");
export const AccountManagement = checkpointStory(
  "Manage signer and Multisig accounts",
  "multisig",
  "account-management",
);
export const Receive = checkpointStory("Receive to shared account", "multisig", "receive");
export const Signers = checkpointStory("Signers and quorum", "multisig", "signers");
export const Track = checkpointStory("Track shared proposal", "multisig", "track");
export const ImportReviewPackage = checkpointStory(
  "Import review package",
  "multisig",
  "track-package",
);
export const Ready = checkpointStory("Ready to execute", "multisig", "ready");
export const ReadyProposal = checkpointStory("Ready proposal detail", "multisig", "ready-proposal");
export const ConfirmOwnedSigner = checkpointStory(
  "Confirm with an owned signer",
  "multisig",
  "confirm-owned-signer",
);
export const SyncFailure = checkpointStory("Refresh failed", "multisig", "registry-unavailable");
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
