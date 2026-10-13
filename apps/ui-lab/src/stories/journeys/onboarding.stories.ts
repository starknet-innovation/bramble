import { expect } from "storybook/test";
import {
  assertCheckpointReady,
  checkpointStory,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

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
export const ChooseImportMethodNoLedger = checkpointStory(
  "Existing wallet · choose method (no Ledger transport)",
  "onboarding",
  "method-no-ledger",
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
export const ReviewRecoveredAccounts = checkpointStory(
  "Existing wallet · discovered accounts",
  "onboarding",
  "recovery-accounts",
);
export const ConfirmRecoveredAccounts = checkpointStory(
  "Existing wallet · confirm recovered accounts",
  "onboarding",
  "recovery-accounts-confirmed",
);
export const ImportPrivateKey = checkpointStory(
  "Existing wallet · private key",
  "onboarding",
  "import-key",
);
export const ChooseAccounts = checkpointStory(
  "New wallet · review the Bramble account",
  "onboarding",
  "accounts",
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
export const BackupMismatch = checkpointStory(
  "Generated phrase · words don't match",
  "onboarding",
  "backup-mismatch",
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
export const UnlockFailed: LabStory = {
  args: { checkpointId: "unlock-failed", scenarioId: "unlock" },
  name: "Returning wallet · unlock failed",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
    await expect(
      frame?.contentDocument?.querySelector("#toast-stack .toast.error"),
    ).toHaveTextContent("Vault passphrase is incorrect");
    await expect(
      frame?.contentDocument?.querySelector("#toast-stack .toast.error .toast-copy"),
    ).toHaveAccessibleName("Copy error details");
    await expect(canvasElement.ownerDocument.querySelector("#toast-stack")).not.toBeInTheDocument();
  },
};
