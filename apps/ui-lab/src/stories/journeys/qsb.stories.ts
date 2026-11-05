import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "qsb-accounts", scenarioId: "qsb" },
  title: "Wallet journeys/12 QSB vaults",
};

export default meta;

export const Accounts = checkpointStory("QSB vaults", "qsb", "qsb-accounts");
export const NoAccounts = checkpointStory("No QSB vaults", "qsb", "qsb-accounts-empty");
export const Creating = checkpointStory("Creating", "qsb", "qsb-create");
export const CreationRefused = checkpointStory("Creation refused", "qsb", "qsb-create-refused");
export const BackupPassphrase = checkpointStory(
  "Backup · passphrase",
  "qsb",
  "qsb-backup-passphrase",
);
export const BackupPhraseMasked = checkpointStory(
  "Backup · phrase masked",
  "qsb",
  "qsb-backup-phrase",
);
export const BackupPhraseShown = checkpointStory(
  "Backup · phrase shown",
  "qsb",
  "qsb-backup-shown",
);
export const BackupCheckWords = checkpointStory("Backup · check words", "qsb", "qsb-backup-verify");
export const BackupMismatch = checkpointStory("Backup · mismatch", "qsb", "qsb-backup-mismatch");
export const BackupConfirmed = checkpointStory("Backup · confirmed", "qsb", "qsb-backup-done");
export const ImportEntry = checkpointStory("Import · entry", "qsb", "qsb-import");
export const ImportRefused = checkpointStory(
  "Import · Starknet phrase",
  "qsb",
  "qsb-import-refused",
);
export const ImportAdded = checkpointStory("Import · added", "qsb", "qsb-import-done");
