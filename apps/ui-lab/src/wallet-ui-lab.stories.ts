import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createUiLab } from "./lab-runtime";

type LabArgs = {
  readonly checkpointId: string;
  readonly scenarioId: string;
};

const meta: Meta<LabArgs> = {
  args: {
    checkpointId: "details",
    scenarioId: "send",
  },
  parameters: {
    chromatic: {
      pauseAnimationAtEnd: true,
    },
    docs: {
      description: {
        component:
          "A fixture-only review bench that renders MC Wallet production HTML, CSS, bindings, and motion. Use Canvas for live motion and the Interactions panel for scripted flow steps; use Chromatic snapshots and comments for durable PR review.",
      },
    },
  },
  render: (args) =>
    createUiLab({
      checkpointId: args.checkpointId,
      scenarioId: args.scenarioId,
    }),
  tags: ["autodocs"],
  title: "Wallet UI Lab/Scenarios",
};

export default meta;
type Story = StoryObj<LabArgs>;

const assertCheckpointReady = async (canvasElement: HTMLElement): Promise<void> => {
  await waitFor(() => {
    const lab = canvasElement.firstElementChild;
    expect(lab).toHaveAttribute("data-lab-ready", "true");
  });
  const error = canvasElement.querySelector("[data-lab-error]");
  expect(error).not.toBeVisible();
  const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
  expect(frame?.contentDocument?.querySelector(".shell")).toBeInTheDocument();
};

const checkpointStory = (name: string, scenarioId: string, checkpointId: string): Story => ({
  args: { checkpointId, scenarioId },
  name,
  play: async ({ canvasElement }) => assertCheckpointReady(canvasElement),
});

export const SendDetails = checkpointStory("Send · details", "send", "details");
export const SendReview = checkpointStory("Send · review", "send", "review");
export const SendFeeFailure = checkpointStory("Send · fee failure", "send", "fee-failure");
export const SendLedgerAuthorization = checkpointStory(
  "Send · Ledger authorization",
  "send",
  "authorizing",
);
export const SendBroadcast = checkpointStory("Send · broadcast", "send", "broadcasting");
export const SendSuccess = checkpointStory("Send · success", "send", "submitted");

export const LedgerConnect = checkpointStory("Ledger · connect", "ledger", "connect");
export const LedgerDeviceChoice = checkpointStory("Ledger · device choice", "ledger", "devices");
export const LedgerApprove = checkpointStory("Ledger · approve", "ledger", "confirming");
export const LedgerFailure = checkpointStory("Ledger · failure", "ledger", "error");

export const DappTakeover = checkpointStory("dApp · takeover", "dapp", "takeover");
export const DappWatchAsset = checkpointStory("dApp · receipt token", "dapp", "watch-asset");
export const DappSnoozed = checkpointStory("dApp · review later", "dapp", "snoozed");

export const ActivityAccountA = checkpointStory("Activity · account A", "activity", "account-a");
export const ActivityScopeCleared = checkpointStory(
  "Activity · switch boundary",
  "activity",
  "scope-cleared",
);
export const ActivityAccountB = checkpointStory("Activity · account B", "activity", "account-b");

export const NftMetadataLoading = checkpointStory(
  "NFT · metadata loading",
  "nft",
  "metadata-loading",
);
export const NftGallery = checkpointStory("NFT · gallery", "nft", "gallery");
export const NftTransferReview = checkpointStory("NFT · transfer review", "nft", "review");
export const NftRecipientBlocked = checkpointStory("NFT · blocked recipient", "nft", "blocked");
export const NftTransferSubmitted = checkpointStory("NFT · submitted", "nft", "submitted");

export const MultisigProposal = checkpointStory("Multisig · proposal", "multisig", "proposal");
export const MultisigReady = checkpointStory("Multisig · ready to execute", "multisig", "ready");
export const MultisigSyncFailure = checkpointStory(
  "Multisig · refresh failed",
  "multisig",
  "sync-error",
);

export const GuidedInteractionWalkthrough: Story = {
  args: { checkpointId: "details", scenarioId: "send" },
  name: "Interaction · step through Send",
  play: async ({ canvasElement, step }) => {
    await assertCheckpointReady(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { level: 2, name: "Details" })).toBeVisible();
    await step("Advance into deterministic review latency", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Step" }));
      await assertCheckpointReady(canvasElement);
      await expect(
        await canvas.findByRole("heading", { level: 2, name: "Preparing review" }),
      ).toBeVisible();
    });
    await step("Advance into the decoded review", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Step" }));
      await assertCheckpointReady(canvasElement);
      await expect(
        await canvas.findByRole("heading", { level: 2, name: "Review ready" }),
      ).toBeVisible();
    });
  },
};
