/**
 * The fee and the value at submission an expanded Activity row shows (mc-wallet issues 463 and
 * 480), from the extension's own code, for the mobile core's port (wallet-core P2):
 *
 * - `receiptFee`: a `starknet_getTransactionReceipt` reply and the `feePaid` that
 *   `readReceiptFee` reads from its result (null when none). `throughProvider` is what
 *   `getTransactionFees` yields for the same reply through the real starknet.js provider: today
 *   always null, because starknet.js 10 hands back a `ReceiptTx` instance, which `isRecord`
 *   refuses for its prototype, so the extension stores no receipt fee at all. The port follows
 *   `readReceiptFee` over the node's JSON; the column shows when the extension starts to agree;
 * - `reconcile`: one stored row, the status reconciliation reads for it and the receipt reply the
 *   node gives, through `reconcileScope` (fees read as `readReceiptFee` reads the reply's
 *   result): whether the receipt was read and the `feePaid` stored;
 * - `record`: stored rows carrying the new fields, and whether `isActivityEntry` accepts them;
 * - `capture`: a row as the send path records it and the cached-price answer it is priced from,
 *   through the background's `withSubmittedPrice`: the price request and the stored
 *   `submittedPrice`;
 * - `fact`: a stored row and the "Network fee" (`activityFeeText`) and "Value at submission"
 *   (`activityRecordFacts`) text the expanded row shows, null when left out.
 *
 * Sponsored (`feePayer`) and gasless (`userFee`) rows are left out: mobile has neither flow.
 * `bun run mobile:parity` writes it; `bun run check` fails on drift. Every value is made up.
 */
import { computeReceiptFees, computeReconcile } from "./fees";
import { computeCapture, computeFacts, computeRecords } from "./rows";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const ACTIVITY_PARITY_FIXTURE_PATH =
  "mobile/core/tests/fixtures/extension-activity-detail.jsonl";

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`: `.jsonl`, so the formatter never reflows generated data
 * and the file stays one line per case.
 */
export const renderActivityParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["receiptFee", await computeReceiptFees()],
    ["reconcile", await computeReconcile()],
    ["record", computeRecords()],
    ["capture", await computeCapture()],
    ["fact", computeFacts()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
