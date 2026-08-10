import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

// Shielding and unshielding are sends between one account's two balances, so
// their compose, review, and submission steps are checkpointed with the other
// send routes. What remains privacy-specific is the entry point: the asset
// screen, where Shield and Unshield each open Send already configured.
const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "asset-entry", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/03 Shield and unshield entry",
};

export default meta;

export const AssetEntry = checkpointStory("Asset privacy action", "privacy", "asset-entry");
