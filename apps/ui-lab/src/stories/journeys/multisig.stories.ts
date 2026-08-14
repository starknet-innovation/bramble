import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "multisig-home", scenarioId: "multisig" },
  title: "Wallet journeys/09 Argent multisig",
};

export default meta;

export const Accounts = checkpointStory("Watched accounts", "multisig", "multisig-home");
export const Intent = checkpointStory("Prepare exact intent", "multisig", "multisig-propose");
export const Deploy = checkpointStory("Deploy account", "multisig", "multisig-deploy");
