/**
 * The portfolio and activity parity fixture for the mobile core: every block is output the
 * extension's own TypeScript produced for a fixed input, so the Rust core (and, through FFI, the
 * Swift app) can prove it renders, judges and caches identically. Deterministic: no network, no
 * real clock. Written by `bun run mobile:parity`; `tests/conformance/mobile-portfolio-parity.test.ts`
 * fails when the committed copy drifts from what the extension computes today.
 */

import { chartsBlock } from "./charts";
import { activityBlock, eventsBlock, starkscanBlock } from "./history";
import { ACTIVITY_NOW, appearanceBlock, statusBlock } from "./presentation";
import { fiatBlock, limitsBlock, numbersBlock, pricesBlock } from "./prices";
import { balancesBlock, tokenMetaBlock, tokensBlock } from "./tokens";

/** Repository-relative path of the committed portfolio/activity parity fixture. */
export const PORTFOLIO_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/portfolio-parity.jsonl";

// Runs every block against the extension's real code.
const computePortfolioParity = async (): Promise<Record<string, unknown>> => ({
  activity: activityBlock(),
  activityNow: ACTIVITY_NOW,
  appearance: appearanceBlock(),
  balances: await balancesBlock(),
  charts: await chartsBlock(),
  events: await eventsBlock(),
  fiat: fiatBlock(),
  limits: limitsBlock(),
  numbers: numbersBlock(),
  prices: await pricesBlock(),
  starkscan: await starkscanBlock(),
  status: statusBlock(),
  tokenMeta: await tokenMetaBlock(),
  tokens: tokensBlock(),
});

/**
 * The fixture text exactly as committed: JSON Lines, one `{"block","value"}` record per block, so
 * the file stays within the repository's line budget, a diff still names the block that moved,
 * and the formatter (which leaves `.jsonl` alone) never reflows generated data. The JSON
 * round-trip drops `undefined`, as every consumer expects.
 */
export const renderPortfolioParity = async (): Promise<string> =>
  Object.entries(await computePortfolioParity())
    .map(([block, value]) => `${JSON.stringify({ block, value })}\n`)
    .join("");
