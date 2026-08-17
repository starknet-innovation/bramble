import { expect, userEvent, waitFor } from "storybook/test";
import {
  assertCheckpointReady,
  checkpointStory,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "details", scenarioId: "send" },
  title: "Wallet journeys/03 Send and swap",
};

export default meta;

export const SendRecipient = checkpointStory("Send · recipient", "send", "recipient");
export const SendDetails = checkpointStory("Send · amount", "send", "details");
export const SendAsset = checkpointStory("Send · asset picker", "send", "asset");
export const SendReview = checkpointStory("Send · review", "send", "review");
export const SendFeeFailure = checkpointStory("Send · fee failure", "send", "fee-failure");
export const SendLedgerAuthorization = checkpointStory(
  "Send · Ledger authorization",
  "send",
  "authorizing",
);
export const SendBroadcast = checkpointStory("Send · broadcast", "send", "broadcasting");
export const SendConfirming = checkpointStory("Send · confirming", "send", "confirming");
export const SendPending = checkpointStory("Send · pending", "send", "pending");
export const SendSuccess = checkpointStory("Send · confirmed", "send", "submitted");
export const SendFailure = checkpointStory("Send · failure", "send", "failed");

export const SwapEdit = checkpointStory("Swap · edit", "swap", "edit");
export const SwapPicker = checkpointStory("Swap · token picker", "swap", "picker");
export const SwapPickerKeyboard: LabStory = {
  args: { checkpointId: "picker", scenarioId: "swap" },
  name: "Swap · token picker keyboard contract",
  play: async ({ canvasElement, step }) => {
    await assertCheckpointReady(canvasElement);
    const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
    const body = frame?.contentDocument?.body;
    const sheet = body?.querySelector<HTMLElement>("#swap-picker");
    const search = body?.querySelector<HTMLInputElement>("#swap-picker-search");
    if (!body || !sheet || !search) throw new Error("Missing swap picker fixture");
    await expect(search).toHaveFocus();
    await step("Escape closes the modal sheet and returns focus", async () => {
      await userEvent.type(search, "{Escape}");
      await waitFor(() => expect(sheet).not.toBeVisible());
      await waitFor(() => expect(body.querySelector("#swap-buy-token")).toHaveFocus());
    });
  },
};
export const SwapLoading = checkpointStory("Swap · finding route", "swap", "loading");
export const SwapQuote = checkpointStory("Swap · quote", "swap", "quote");
export const SwapHighRisk = checkpointStory("Swap · high-loss route", "swap", "high-risk");
export const SwapQuoteFailure = checkpointStory("Swap · no route", "swap", "quote-failed");
export const SwapReview: LabStory = {
  args: { checkpointId: "review", scenarioId: "swap" },
  name: "Swap · frozen review",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("#swap-confirm")).toBeVisible();
    await expect(body?.querySelector("#swap-confirm-receipt")).toHaveTextContent(
      /Minimum received\s*19,260 STRK \(wallet-enforced\)/,
    );
    await expect(body?.querySelector("#swap-risk-review")).toHaveTextContent("Risk and recovery");
  },
};
export const SwapExecutionFailure = checkpointStory(
  "Swap · execution failed",
  "swap",
  "execute-failed",
);
export const SwapSubmitted = checkpointStory("Swap · submitted", "swap", "submitted");
