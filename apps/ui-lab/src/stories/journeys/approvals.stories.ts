import { expect } from "storybook/test";
import {
  assertCheckpointReady,
  assertValueFits,
  checkpointStory,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

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
export const TypedDataNested: LabStory = {
  args: { checkpointId: "typed-data-nested", scenarioId: "approvals" },
  name: "Approval · nested typed data",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    const block = [...(body?.querySelectorAll<HTMLElement>(".sign-block") ?? [])].at(-1);
    await expect(block).toBeVisible();
    // No row may be wider than the card, and every signed value keeps a
    // visible width beside its key (Sherlock 257).
    expect(block?.scrollWidth ?? 1).toBeLessThanOrEqual(block?.clientWidth ?? 0);
    const values = [...(block?.querySelectorAll<HTMLElement>(".sign-val") ?? [])];
    expect(values.length).toBeGreaterThan(3);
    for (const value of values) {
      expect(value.getBoundingClientRect().width).toBeGreaterThan(40);
    }
  },
};
export const PrivateInvoke = checkpointStory(
  "Approval · private transaction",
  "approvals",
  "private-invoke",
);
export const WatchAsset: LabStory = {
  args: { checkpointId: "watch-asset", scenarioId: "approvals" },
  name: "Approval · watch asset",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const document =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument;
    const mark = document?.querySelector<HTMLElement>(".request-token .token-mark");
    await expect(mark).toBeVisible();
    if (!document) {
      throw new Error("UI Lab wallet frame is unavailable");
    }
    assertValueFits(document, ".request-token .token-mark");
  },
};
export const SwitchChain = checkpointStory("Approval · switch chain", "approvals", "switch-chain");
export const AddChain = checkpointStory("Approval · add chain", "approvals", "add-chain");
export const Declare = checkpointStory("Approval · declare", "approvals", "declare");
export const Blocked = checkpointStory("Approval · blocked origin", "approvals", "blocked-origin");
export const Queue = checkpointStory("Approval · request queue", "approvals", "queue");

export const Takeover = checkpointStory("Takeover · active request", "dapp", "takeover");
export const ReceiptToken = checkpointStory("Takeover · receipt token", "dapp", "watch-asset");
export const ReviewLater = checkpointStory("Takeover · review later", "dapp", "snoozed");
export const ParkedRequests = checkpointStory("Takeover · parked list", "dapp", "parked-list");
