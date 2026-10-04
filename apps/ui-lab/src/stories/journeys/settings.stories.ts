import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "hub", scenarioId: "settings-security" },
  title: "Wallet journeys/10 Settings and security",
};

export default meta;

export const Hub = checkpointStory("Settings hub", "settings-security", "hub");
export const Appearance = checkpointStory(
  "Appearance & currency",
  "settings-security",
  "appearance",
);
export const RequestBehavior = checkpointStory(
  "Wallet request behavior",
  "settings-security",
  "request-settings",
);
export const Network = checkpointStory("Choose network", "settings-security", "network");
export const AdvancedEndpoints = checkpointStory(
  "Advanced endpoints",
  "settings-security",
  "advanced-endpoints",
);
export const ExplorerData = checkpointStory(
  "Explorer data and rejected request",
  "settings-security",
  "explorer-data",
);
export const MultisigCoordinationRelay = checkpointStory(
  "Multisig coordination relay",
  "settings-security",
  "nostr-relay",
);
export const Accounts = checkpointStory("Accounts and groups", "settings-security", "accounts");
export const HiddenAccounts = checkpointStory(
  "Hidden accounts",
  "settings-security",
  "hidden-accounts",
);
export const ImportKey = checkpointStory("Import private key", "settings-security", "import-key");
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
export const BackupExport = checkpointStory(
  "Backup · download",
  "settings-security",
  "backup-export",
);
export const BackupRestore = checkpointStory(
  "Backup · restore",
  "settings-security",
  "backup-restore",
);
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
