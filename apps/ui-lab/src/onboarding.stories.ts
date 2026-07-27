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
export const ChooseImportMethod = checkpointStory(
  "Existing wallet · choose method",
  "onboarding",
  "method",
);
export const EnterRecoveryPhrase = checkpointStory(
  "Existing wallet · recovery phrase",
  "onboarding",
  "recovery",
);
export const CreatePassword = checkpointStory(
  "Existing wallet · create passphrase",
  "onboarding",
  "password",
);
export const ChooseAccounts = checkpointStory(
  "Existing wallet · choose accounts",
  "onboarding",
  "accounts",
);
export const AccountSelected = checkpointStory(
  "Existing wallet · account selected",
  "onboarding",
  "account-selected",
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
export const LedgerPassword = checkpointStory(
  "Ledger wallet · local passphrase",
  "onboarding",
  "ledger-password",
);
export const SetupComplete = checkpointStory("Setup · complete", "onboarding", "complete");
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
