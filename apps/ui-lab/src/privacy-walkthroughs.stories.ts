import { expect, userEvent, within } from "storybook/test";
import { RECIPIENT_ADDRESS } from "./fixtures";
import { assertCheckpointReady, LAB_META, type LabMeta, type LabStory } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "activation-required", scenarioId: "privacy" },
  title: "Wallet journeys/04 Private balances/06 Guided walkthroughs",
};

export default meta;

const expectCheckpoint = async (canvasElement: HTMLElement, name: string): Promise<void> => {
  await assertCheckpointReady(canvasElement);
  await expect(await within(canvasElement).findByRole("heading", { level: 2, name })).toBeVisible();
};

const stepForward = async (canvasElement: HTMLElement, name: string): Promise<void> => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Step" }));
  await expectCheckpoint(canvasElement, name);
};

const walletBody = (canvasElement: HTMLElement): HTMLElement => {
  const body =
    canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
  if (!body) {
    throw new Error("Missing wallet fixture body");
  }
  return body;
};

export const ActivatePrivateBalances: LabStory = {
  name: "Walkthrough · activate private balances",
  play: async ({ canvasElement, step }) => {
    await expectCheckpoint(canvasElement, "Activation required");
    await step("Review the public registration boundary", async () => {
      await stepForward(canvasElement, "Review activation");
      expect(walletBody(canvasElement)).toHaveTextContent("Registration is public");
    });
    await step("Keep proof and authorization progress visible", async () => {
      await stepForward(canvasElement, "Proof and authorization");
      expect(walletBody(canvasElement)).toHaveTextContent("Generate proof and authorize");
    });
    await step("Confirm acceptance and point at the next step", async () => {
      await stepForward(canvasElement, "Activation submitted");
      expect(walletBody(canvasElement)).toHaveTextContent("You can now shield");
    });
  },
};

// There is no shielding walkthrough here any more: shield and unshield are
// composed in Send, so their steps belong with the other send routes rather than
// on the registration surface this file walks.

export const SendPrivately: LabStory = {
  args: { checkpointId: "transfer-review", scenarioId: "privacy" },
  name: "Walkthrough · send privately",
  play: async ({ canvasElement, step }) => {
    await expectCheckpoint(canvasElement, "Review private transfer");
    const review = walletBody(canvasElement);
    expect(review).toHaveTextContent("Exact action parameters");
    expect(review).toHaveTextContent("Relay fee action");
    await step("Inspect the exact transfer and relay parameters", async () => {
      await stepForward(canvasElement, "Inspect transfer parameters");
      expect(walletBody(canvasElement)).toHaveTextContent(RECIPIENT_ADDRESS);
    });
    await step("Lock the frozen request during authorization", async () => {
      await stepForward(canvasElement, "Authorize private transfer");
      expect(walletBody(canvasElement)).toHaveTextContent("Approved. Signing and broadcasting");
    });
  },
};

export const SwapPrivately: LabStory = {
  args: { checkpointId: "private-swap-review", scenarioId: "privacy" },
  name: "Walkthrough · AVNU private swap",
  play: async ({ canvasElement, step }) => {
    await expectCheckpoint(canvasElement, "Review private swap");
    const review = walletBody(canvasElement);
    expect(review).toHaveTextContent("4 actions");
    expect(review).toHaveTextContent("Contract invoke");
    await step("Inspect all four frozen actions", async () => {
      await stepForward(canvasElement, "Inspect private swap route");
      expect(walletBody(canvasElement)).toHaveTextContent("Action 4 · Contract invoke");
    });
    await step("Hold the validated route while proving", async () => {
      await stepForward(canvasElement, "Prepare private swap proof");
      expect(walletBody(canvasElement)).toHaveTextContent("Approved. Signing and broadcasting");
    });
  },
};
