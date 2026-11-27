/**
 * Dapp connect from the extension's own code, for the mobile core's port (wallet-core P16): a
 * site's requests to the wallet, whatever carried them. Blocks:
 *
 * - `request`: reading a page's `(method, params)` through the page script's and the content
 *   script's gates, the hostile-JSON budget per method included (see `request.ts`);
 * - `connect`: `wallet_requestAccounts`, `mc_*`, permissions, chain id and the discovery methods
 *   through the background's message handler, and the connect card's decision (`connect.ts`);
 * - `grants`: origin grants written and revoked through the vault service (`grants.ts`);
 * - `queue`: the approval queue's caps, dedupe, waiters, reservations and TTL (`queue.ts`);
 * - `site`, `feedParse`, `feed`: the blocklist and site warnings, and the live phishing feed
 *   (`sites.ts`);
 * - `sign`: `wallet_signTypedData` through the background's message handler and every gate
 *   before its card: lock (before and mid-flight), blocklist, grant, a presented multisig, and
 *   the document's chain against the account's (`sign.ts`);
 * - `typedData`, `outside`: SNIP-12 typed data's gate, chain binding and summary, and a SNIP-9
 *   outside execution's call review at queue time and at signing (`typed-data.ts`).
 *
 * Not covered: invoke, declare, switch-chain, watch-asset and add-chain past reading their params
 * (their reviews and decisions follow the core's next PRs), STRK20 methods (P15), and signing
 * itself (the signature depends on the key, which the sign tests in wallet-core cover over a real
 * vault). `bun run mobile:parity` writes it; the drift test fails when the extension's code
 * changes it. Every address is made up but for the tracked tokens.
 */
import { computeConnect } from "./connect";
import { computeGrants } from "./grants";
import { computeQueue } from "./queue";
import { computeRequests } from "./request";
import { computeSign } from "./sign";
import { computeFeed, computeFeedParse, computeSites } from "./sites";
import { computeOutside, computeTypedData } from "./typed-data";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const DAPP_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/extension-dapp.jsonl";

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`, so the formatter never reflows generated data.
 */
export const renderDappParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["request", computeRequests()],
    ["connect", await computeConnect()],
    ["grants", await computeGrants()],
    ["queue", await computeQueue()],
    ["site", computeSites()],
    ["feedParse", computeFeedParse()],
    ["feed", await computeFeed()],
    ["typedData", computeTypedData()],
    ["outside", computeOutside()],
    ["sign", await computeSign()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
