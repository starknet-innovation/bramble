import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "connect", scenarioId: "ledger" },
  title: "Wallet journeys/04 Ledger",
};

export default meta;

export const Connect = checkpointStory("Signing · connect", "ledger", "connect");
export const DeviceChoice = checkpointStory("Signing · device choice", "ledger", "devices");
export const Approve = checkpointStory("Signing · approve", "ledger", "confirming");
export const Failure = checkpointStory("Signing · failure", "ledger", "error");

export const ChooseMethod = checkpointStory(
  "Add account · choose method",
  "ledger-onboarding",
  "method",
);
export const ChooseDevice = checkpointStory(
  "Add account · choose device",
  "ledger-onboarding",
  "devices",
);
export const SelectAccounts = checkpointStory(
  "Add account · select accounts",
  "ledger-onboarding",
  "accounts",
);
export const PartialAdd = checkpointStory(
  "Add account · partial recovery",
  "ledger-onboarding",
  "partial-add",
);
