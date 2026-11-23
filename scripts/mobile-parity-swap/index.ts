/**
 * AVNU token swaps from the extension's own code, for the mobile core's port (wallet-core P11),
 * through the REAL background handler (`swap-ops.ts`: `wallet.swapQuote`, `wallet.swapPrepare`,
 * `wallet.swapExecute`) over the real AVNU service (`createSwapService`) whose fetch answers from
 * a script:
 *
 * - `quote`: the pair and amount asked, an optional made-up price feed, AVNU's reply, the GET the
 *   service sent, and the handler's answer: the quote the panel shows with the wallet's own value
 *   check (`walletSwapValueDelta`), or the refusal (the panel's input rules, the reply's grammar,
 *   a reply for another pair or amount);
 * - `build`: a quote, then a preparation against it: AVNU's build reply, the POST the service sent
 *   and the handler's answer. An accepted build carries the review (per-call lines, flags, the
 *   route's minimum) and is executed against a node that lands it, recording the calls that
 *   reached the signer and the activity row; a refused one carries the refusal, covering every
 *   reason `buildPolicy` gives in its order, the build envelope, each call's grammar and the
 *   preparation's input rules;
 * - `floor`: `reviewedMinBuyAmount` over quotes and slippages, null where it states no floor.
 *
 * Left out: the token catalog (`listTokens`, not ported), the fee estimate and the preparation
 * store's digest (the core leaves both to the host), and a lost reply at execute (the plan's).
 * `bun run mobile:parity` writes it; the drift test fails when the extension's code changes it.
 * Every address, amount and id is made up but for the tracked tokens and AVNU's pinned router.
 */
import { reviewedMinBuyAmount } from "@bramble/transactions/avnu-route";
import { computeBuilds } from "./builds";
import { computeQuotes } from "./quotes";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const SWAP_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/extension-swap.jsonl";

const FLOORS: readonly (readonly [string, bigint, number])[] = [
  ["the default slippage", 125n * 10n ** 17n, 0.005],
  ["a 1% slippage", 125n * 10n ** 17n, 0.01],
  ["a slippage that is not a whole basis point", 125n * 10n ** 17n, 0.00501],
  ["the largest slippage the panel allows", 11_234_567n, 0.05],
  ["a quote of one unit", 1n, 0.005],
  ["a quote of 99 units", 99n, 0.005],
  ["the largest u256 quote", 2n ** 256n - 1n, 0.005],
  ["a zero quote", 0n, 0.005],
  ["a zero slippage", 10n ** 18n, 0],
  ["a slippage that leaves nothing", 10n ** 18n, 0.9999],
  ["a slippage of one", 10n ** 18n, 1],
];

const computeFloors = (): readonly object[] =>
  FLOORS.map(([name, quoted, slippage]) => ({
    floor: reviewedMinBuyAmount(quoted, slippage)?.toString() ?? null,
    name,
    quoted: quoted.toString(),
    slippage,
  }));

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`, so the formatter never reflows generated data.
 */
export const renderSwapParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["quote", await computeQuotes()],
    ["build", await computeBuilds()],
    ["floor", computeFloors()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
