import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "welcome", scenarioId: "onboarding" },
  title: "Wallet journeys/01 Onboarding",
};

export default meta;

export const ChooseSetup = checkpointStory(
  "Full-screen setup · choose path",
  "onboarding",
  "welcome",
);
export const GeneratedPhrase = checkpointStory(
  "Generated phrase · masked",
  "onboarding",
  "generated-masked",
);
export const BackupConfirmed = checkpointStory(
  "Generated phrase · backup confirmed",
  "onboarding",
  "backup-confirmed",
);
export const ImportExisting = checkpointStory(
  "Import existing wallet",
  "onboarding",
  "import-existing",
);
export const ReturningLocked = checkpointStory("Returning wallet · locked", "unlock", "locked");
export const RequestWaiting = checkpointStory(
  "Returning wallet · request waiting",
  "unlock",
  "locked-request",
);
export const UnlockFailed = checkpointStory(
  "Returning wallet · unlock failed",
  "unlock",
  "unlock-failed",
);
