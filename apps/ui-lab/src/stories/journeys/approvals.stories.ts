import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "connect", scenarioId: "approvals" },
  title: "Wallet journeys/06 dApp requests",
};

export default meta;

export const Connect = checkpointStory("Approval · connect", "approvals", "connect");
export const Invoke = checkpointStory("Approval · transaction", "approvals", "invoke");
export const Processing = checkpointStory("Approval · authorizing", "approvals", "processing");
export const TypedData = checkpointStory("Approval · typed data", "approvals", "typed-data");
export const PrivateInvoke = checkpointStory(
  "Approval · private transaction",
  "approvals",
  "private-invoke",
);
export const WatchAsset = checkpointStory("Approval · watch asset", "approvals", "watch-asset");
export const SwitchChain = checkpointStory("Approval · switch chain", "approvals", "switch-chain");
export const AddChain = checkpointStory("Approval · add chain", "approvals", "add-chain");
export const Declare = checkpointStory("Approval · declare", "approvals", "declare");
export const Blocked = checkpointStory("Approval · blocked origin", "approvals", "blocked-origin");
export const Queue = checkpointStory("Approval · request queue", "approvals", "queue");

export const Takeover = checkpointStory("Takeover · active request", "dapp", "takeover");
export const ReceiptToken = checkpointStory("Takeover · receipt token", "dapp", "watch-asset");
export const ReviewLater = checkpointStory("Takeover · review later", "dapp", "snoozed");
export const ParkedRequests = checkpointStory("Takeover · parked list", "dapp", "parked-list");
