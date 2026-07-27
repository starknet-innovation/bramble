import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "details", scenarioId: "send" },
  title: "Wallet journeys/03 Send and swap",
};

export default meta;

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

export const SwapEdit = checkpointStory("Swap · edit", "swap", "edit");
export const SwapPicker = checkpointStory("Swap · token picker", "swap", "picker");
export const SwapLoading = checkpointStory("Swap · finding route", "swap", "loading");
export const SwapQuote = checkpointStory("Swap · quote", "swap", "quote");
export const SwapHighRisk = checkpointStory("Swap · high-loss route", "swap", "high-risk");
export const SwapQuoteFailure = checkpointStory("Swap · no route", "swap", "quote-failed");
export const SwapReview = checkpointStory("Swap · frozen review", "swap", "review");
export const SwapExecutionFailure = checkpointStory(
  "Swap · execution failed",
  "swap",
  "execute-failed",
);
export const SwapSubmitted = checkpointStory("Swap · submitted", "swap", "submitted");
