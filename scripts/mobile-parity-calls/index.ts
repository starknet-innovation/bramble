/**
 * The pre-sign call review and the invoke submission of a call batch, from the extension's own
 * code, for the mobile core's port (wallet-core P9, and P1's call summaries beyond an ERC-20
 * transfer):
 *
 * - `decode`: one call and what `decodeCall` (`routing/verify-decode.ts`) makes of it, its kind
 *   and summary, and the payee `recipientForFlags` reads: every shape it knows (ERC-20 transfer,
 *   approve and its increase spellings, the decrease duals it leaves opaque, NFT item and operator
 *   grants, the three transfer-from families, an AVNU route), an Argent multisig signer change
 *   (opaque to it), unknown selectors and calldata that misses each shape;
 * - `flags`: a batch, the review context and allowance log it is judged against, and what
 *   `verifyCalls` (`routing/verify.ts`) reports, each call's decode and the card's deduplicated
 *   flags, with `refuseOnPoisonedRecipient`'s refusal; every flag is raised at least once;
 * - `submit`: a four-call batch through `estimateInvokeFee` and `submitInvokeTransaction` on a
 *   recording node (deployed, mainnet, deploying first, and a fee that rose past the review), every
 *   request in order with its reply, the hashes signed, and the hash accepted or the refusal;
 * - `refusal`: batches the invoke path refuses before it reads anything (`submitInvokeTransaction`,
 *   `refuseOnAccountSelfCall`, `providerInvokeRequest`'s bounds and grammar) and the ones on each
 *   bound that pass.
 *
 * Left out: calldata that is not a felt (the core reads calldata its callers parsed, so the
 * extension's `BigInt` leniency over strings has no counterpart), the STRK20 proof and gasless
 * lanes (mobile has neither), and `verificationContext`'s trust filtering of preferences (the
 * core takes the trusted set its caller built). `bun run mobile:parity` writes it;
 * `bun run check` fails on drift. Every value is made up; signing uses the published E2E phrase.
 */
import { computeDecodes } from "./decode";
import { computeFlags } from "./flags";
import { computeRefusals, computeSubmits } from "./submit";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const CALLS_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/extension-call-review.jsonl";

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`.
 */
export const renderCallsParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["decode", computeDecodes()],
    ["flags", computeFlags()],
    ["submit", await computeSubmits()],
    ["refusal", await computeRefusals()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
