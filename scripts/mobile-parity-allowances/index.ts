/**
 * ERC-20 allowances (wallet-core P12), from the extension's own code, for the mobile core's
 * port (`allowances::{discovery, record, retention, store, calls, revoke, scan, tracked}`):
 *
 * - `decode`: an event and what `decodeApprovalEvent` reads from it (Cairo 1 and legacy layouts,
 *   wrong selector, short keys or data, zero or non-felt owner and spender, an ERC-721 shape);
 * - `amount`: an `allowance` reply and `parseAllowanceAmount`'s decimal, null when refused;
 * - `unlimited`: amounts either side of `isUnlimitedAllowance`'s cut-off (2^128 - 1);
 * - `record`: stored values and whether `isAllowanceRecord` keeps them on load;
 * - `merge`: `mergeAllowanceViews`' input and views (dedupe, readings over the scan, lower
 *   bounds resolved, pending revokes, multisig rows);
 * - `outstanding`, `notices`: the listing's `outstandingAllowances` and `listingNotices`
 *   (`allowance-ops.ts`, exported for this);
 * - `retention`: `keepLargest` and `trimToTotal` at small limits, ranked by trusted decimals;
 * - `log`: the persistent store over a seeded value, op by op, with the stored value after each
 *   (approve, both deltas, saturation, revoke marks, settling on readings and outcomes, the
 *   per-scope cap, invalid records dropped);
 * - `recording`: `recordApproveAllowances` over a submitted batch and the stored value after;
 * - `outcomes`: `revokeOutcomes` (exported for this) over activity rows;
 * - `revoke`: `allowanceTarget` for an id and the `approve(spender, 0)` built for its target;
 * - `scan`, `tracked`: `scanExternalAllowances` and `readTrackedAllowances` over a small fake
 *   node, as the transcript of every provider call (block ids and bounds as sent) and answer,
 *   then the result (see `./scan.ts`).
 *
 * Left out: the handlers' orchestration (`handleListAllowances`, `handleRevokeAllowance`: which
 * scopes, the fee review and submission), which stays the wallet's; the 50-spender cap per token
 * and the 60-pair cap on tracked reads (unit-tested both sides; a transcript would be 50 reads);
 * `withRpcFallback`'s endpoint order. `bun run mobile:parity` writes it; `bun run check` fails on
 * drift. Every value is made up.
 */
import { computeDiscovery } from "./discovery";
import { computeLog } from "./log";
import { computeScans } from "./scan";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const ALLOWANCES_PARITY_FIXTURE_PATH =
  "mobile/core/tests/fixtures/extension-allowances.jsonl";

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`: `.jsonl`, so the formatter never reflows generated data.
 */
export const renderAllowancesParity = async (): Promise<string> => {
  const blocks = [...computeDiscovery(), ...(await computeLog()), ...(await computeScans())];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
