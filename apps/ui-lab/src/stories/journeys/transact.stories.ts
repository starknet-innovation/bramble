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
    const trigger = body?.querySelector<HTMLButtonElement>("#swap-buy-token");
    const panel = body?.querySelector<HTMLElement>("#swap-buy-options");
    if (!body || !trigger || !panel) throw new Error("Missing swap dropdown fixture");
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Opening moves focus into the panel: onto the catalog search when the list
    // has one, otherwise onto the first option.
    const focused = body.ownerDocument.activeElement;
    if (!focused || !panel.contains(focused)) throw new Error("Focus did not enter the dropdown");
    await step("Escape closes the dropdown and returns focus to its trigger", async () => {
      // Typed at the focused element itself: the key has to reach the frame's
      // document, and a click first would pick whatever option holds focus.
      await userEvent.type(focused as HTMLElement, "{Escape}", { skipClick: true });
      await waitFor(() => expect(panel).not.toBeVisible());
      await waitFor(() => expect(trigger).toHaveFocus());
    });
  },
};
export const SwapLoading = checkpointStory("Swap · finding route", "swap", "loading");
export const SwapQuote = checkpointStory("Swap · quote", "swap", "quote");
export const SwapFlipValues: LabStory = {
  args: { checkpointId: "quote", scenarioId: "swap" },
  name: "Swap · flip preserves values",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    const flip = body?.querySelector<HTMLButtonElement>("#swap-flip");
    if (!body || !flip) throw new Error("Missing swap flip fixture");
    await userEvent.click(flip);
    await waitFor(() =>
      expect(body.querySelector<HTMLInputElement>("#swap-sell-amount")).toHaveValue("19357"),
    );
    await expect(body.querySelector("#swap-buy-amount")).toHaveTextContent("1.25");
    await expect(body.querySelector("#swap-sell-token")).toHaveTextContent("STRK");
    await expect(body.querySelector("#swap-buy-token")).toHaveTextContent("ETH");
  },
};
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
    await expect(body?.querySelectorAll(".swap-review-pair .token-logo")).toHaveLength(2);
    await expect(body?.querySelector("#swap-risk-review")).toBeEmptyDOMElement();
    await expect(body?.querySelector("#swap-confirm-button")).toBeVisible();
  },
};
export const SwapExecutionFailure = checkpointStory(
  "Swap · execution failed",
  "swap",
  "execute-failed",
);
export const SwapSubmitted = checkpointStory("Swap · submitted", "swap", "submitted");
