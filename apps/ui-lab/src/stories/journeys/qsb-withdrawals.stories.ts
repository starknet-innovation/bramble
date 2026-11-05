import {
  assertInsidePanel,
  assertValueFits,
  checkpointStory,
  LAB_META,
  type LabMeta,
  narrowSidepanelStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "qsb-withdrawals-rows", scenarioId: "qsb-withdrawals" },
  title: "Wallet journeys/14 QSB withdrawals",
};

export default meta;

const story = (name: string, id: string) => checkpointStory(name, "qsb-withdrawals", id);

export const Rows = story("Deposits · every withdrawal state", "qsb-withdrawals-rows");
export const Funded = story("Deposits · Withdraw", "qsb-withdrawals-funded");
export const Destination = story("Withdraw · destination", "qsb-withdraw-destination");
export const NotAnAddress = story("Withdraw · not an address", "qsb-withdraw-invalid");
export const HelperNeeded = story("Withdraw · helper needed", "qsb-withdraw-helper");
export const Summary = story("Withdraw · summary", "qsb-withdraw-summary");
export const Accepted = story("Withdraw · costs accepted", "qsb-withdraw-accepted");
export const Starting = story("Withdraw · starting", "qsb-withdraw-starting");
export const QuoteChanged = story("Withdraw · cost changed", "qsb-withdraw-quote-changed");
export const WithdrawAccess = story("Withdraw · access not granted", "qsb-withdraw-access");
export const Review = story("Release · review", "qsb-release-review");
export const Mismatch = story("Release · doesn't check out", "qsb-release-mismatch");
export const Refused = story("Release · refused", "qsb-release-refused");
export const Sending = story("Release · sending", "qsb-release-sending");
export const Sent = story("Release · sent", "qsb-release-sent");
export const Uncertain = story("Release · not confirmed yet", "qsb-release-uncertain");
export const Confirmed = story("Release · withdrawn", "qsb-release-confirmed");
export const Conflict = story("Release · conflict", "qsb-release-conflict");
export const ReviewChanged = story("Release · review changed", "qsb-release-changed");
export const Unknown = story("Release · status unknown", "qsb-release-unknown");
export const ReleaseAccess = story("Release · access not granted", "qsb-release-access");
export const NotReady = story("Release · not ready", "qsb-release-not-ready");

// The narrowest side panel: every row, the summary's sum and full
// destination, and the release review's facts and warning stay inside the
// panel and readable.
export const RowsNarrow = narrowSidepanelStory(
  "Deposits · every withdrawal state · 320px",
  "qsb-withdrawals",
  "qsb-withdrawals-rows",
  [
    (document) => assertInsidePanel(document, "[data-qsb-vault]"),
    (document) => assertInsidePanel(document, "[data-qsb-tx]"),
  ],
);
export const SummaryNarrow = narrowSidepanelStory(
  "Withdraw summary · 320px",
  "qsb-withdrawals",
  "qsb-withdraw-accepted",
  [(document) => assertValueFits(document, "#qsb-withdraw-quote .receipt-row dd")],
);
export const DestinationNarrow = narrowSidepanelStory(
  "Withdraw destination · 320px",
  "qsb-withdrawals",
  "qsb-withdraw-invalid",
  [(document) => assertValueFits(document, "#qsb-destination-result")],
);
export const ReviewNarrow = narrowSidepanelStory(
  "Release review · 320px",
  "qsb-withdrawals",
  "qsb-release-review",
  [
    (document) => assertValueFits(document, "#qsb-binding-warning"),
    (document) => assertValueFits(document, "#qsb-release-review .receipt-row dd"),
  ],
);
export const SentNarrow = narrowSidepanelStory(
  "Release sent · 320px",
  "qsb-withdrawals",
  "qsb-release-sent",
  [(document) => assertInsidePanel(document, "#qsb-release-tx")],
);
export const ConflictNarrow = narrowSidepanelStory(
  "Release conflict · 320px",
  "qsb-withdrawals",
  "qsb-release-conflict",
);
