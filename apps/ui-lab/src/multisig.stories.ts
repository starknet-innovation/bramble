import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "list", scenarioId: "multisig" },
  title: "Wallet journeys/08 Multisig",
};

export default meta;

export const Watched = checkpointStory("Watched multisigs", "multisig", "list");
export const Proposal = checkpointStory("Proposal detail", "multisig", "proposal");
export const Ready = checkpointStory("Ready to execute", "multisig", "ready");
export const SyncFailure = checkpointStory("Refresh failed", "multisig", "sync-error");
export const Propose = checkpointStory("Create proposal", "multisig", "propose");
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
export const Untracked = checkpointStory("Shared proposal", "multisig", "shared-untracked");
export const Executed = checkpointStory("Executed proposal", "multisig", "executed");
