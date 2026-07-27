import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "hub", scenarioId: "settings-security" },
  title: "Wallet journeys/09 Settings and security",
};

export default meta;

export const Hub = checkpointStory("Settings hub", "settings-security", "hub");
export const Network = checkpointStory("Choose network", "settings-security", "network");
export const AdvancedEndpoints = checkpointStory(
  "Advanced endpoints",
  "settings-security",
  "advanced-endpoints",
);
export const Accounts = checkpointStory("Accounts and groups", "settings-security", "accounts");
export const ClassMismatch = checkpointStory(
  "Account class mismatch",
  "settings-security",
  "class-mismatch",
);
export const ConnectedSites = checkpointStory(
  "Connected sites",
  "settings-security",
  "connected-sites",
);
export const Backup = checkpointStory("Mixed-wallet backup", "settings-security", "backup");
export const RevealSoftware = checkpointStory(
  "Recovery · software",
  "settings-security",
  "reveal-software",
);
export const RevealImported = checkpointStory(
  "Recovery · imported key",
  "settings-security",
  "reveal-imported",
);
export const RevealLedger = checkpointStory(
  "Recovery · Ledger",
  "settings-security",
  "reveal-ledger",
);
