/**
 * Gasless fees from the extension's own code, for the mobile core's port (wallet-core P14): a
 * SNIP-9 v2 outside execution the gateway builds and the wallet checks before signing, and the
 * paymaster's bodies and replies. Blocks:
 *
 * - `hash`: the typed data starknet.js builds and its message hash, beside Krusty's hash of the
 *   same JSON and whether they agree (see `hashes.ts`; the plan asks this first);
 * - `review`: a gateway-built body checked by `validateGaslessTypedData` and submitted through
 *   `submitReviewedGaslessInvoke` (bodies posted, hash signed, submission or refusal);
 * - `offers`: `quoteGaslessOffers`, the fee choices a review shows, with every body posted;
 * - `wire`: `postGasless` judging each reply as a quote and as an execute;
 * - `buildParams`, `supportedTokens`, `available`, `quote`, `transactionHash`, `offerShape`,
 *   `account`, `ceiling`: the pure readers and builders over direct inputs.
 *
 * Left out: sponsored fee modes (the extension cannot express one), the background's account
 * re-read and price reference (`gasless-review.ts`, the host's), the pending-relay journal, and
 * activity rows. `bun run mobile:parity` writes it; the drift test fails when the extension's code
 * changes it. Every address, amount and hash is made up but for the tracked tokens and the pinned
 * mainnet forwarder.
 */
import { computeHashes } from "./hashes";
import { computeOffers } from "./offers";
import { computeReads } from "./reads";
import { computeReviews } from "./review";
import { computeWire } from "./wire";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const GASLESS_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/extension-gasless.jsonl";

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`, so the formatter never reflows generated data.
 */
export const renderGaslessParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["hash", await computeHashes()],
    ["review", await computeReviews()],
    ["offers", await computeOffers()],
    ["wire", await computeWire()],
    ...computeReads(),
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
