import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "asset-entry", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/03 Shielding",
};

export default meta;

export const AssetEntry = checkpointStory("Asset privacy action", "privacy", "asset-entry");
export const ChooseAmount = checkpointStory("Choose shield amount", "privacy", "shield-compose");
export const Review = checkpointStory("Review shielding", "privacy", "shield-review");
export const Proving = checkpointStory("Shielding in progress", "privacy", "shielding");
export const Submitted = checkpointStory("Shielding submitted", "privacy", "shielded");
export const Failed = checkpointStory("Recover from failure", "privacy", "shield-failed");
