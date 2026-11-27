/**
 * Native staking (issue 750) from the extension's own code, for the mobile core's port
 * (wallet-core P13, `staking::{coverage, directory, positions, decode, read, view, calls, review,
 * prepare}` and bramble-core's `STAKING_POLICY`):
 *
 * - `context`: the account, clock, staking contract, Starkscan base and the tracked Mainnet
 *   tokens every other block runs with;
 * - `coverage`: a Starkscan coverage block and what `stakingCoverage` makes of it ("usable",
 *   "incomplete", or null for a block that refuses the whole answer);
 * - `decode`: one raw staking-contract or pool reply and what its decoder returns
 *   (`staking-decode.ts`: the value, "none", or null for anything off the layout);
 * - `verify`: three raw replies for STAKER (pool info, status, the pool's own parameters) and
 *   `verifyStakingPool`'s verdict for the expected staker, contract and token;
 * - `overview`: `wallet.stakingOverview` for one staker (`enabled`: staking on in the network
 *   table), with every JSON-RPC exchange the real `readAtPinnedBlock` made (pin, facts, staker
 *   and pool reads, re-pins on "Block not found") and the rows the background answered;
 * - `directory`: `wallet.stakingDirectory` with the request the real Starkscan client sent, the
 *   page it was answered with, and the background's answer (entries, incomplete, or refusal);
 * - `positions`: `wallet.stakingPositions` the same way (`explorerFallback`: the person's
 *   per-network choice that lets Starkscan see the address), plus the node's traffic for the
 *   candidates it read on chain;
 * - `action`: one `wallet.stakingPrepare` (then `wallet.stakingExecute` when it is reviewable):
 *   the node's traffic, the calls estimated and submitted, the review sentence, and the Activity
 *   row and allowance filed for the signed hash; or the refusal.
 *
 * Every chain is `tests/support/staking-chain.ts` answered over the wire; every Starkscan page
 * the schema-derived fixtures the extension's tests use. Left out: the fee estimate, signing and
 * the preparation digest (the shared send path, pinned by the transaction fixtures), the
 * Starkscan cooldown, and the side panel. `bun run mobile:parity` writes it; `bun run check`
 * fails on drift. Every value is made up.
 */
import { computeActions } from "./actions";
import { computeDecodes, computeOverviews, computeVerdicts } from "./chain";
import { ACCOUNT, background, NOW_SECONDS, STAKING_CONTRACT, STARKSCAN_BASE } from "./shared";
import { computeCoverage, computeDirectory, computePositions } from "./starkscan";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const STAKING_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/extension-staking.jsonl";

const computeContext = async () => {
  const { tokens } = await background();
  return [
    {
      account: ACCOUNT,
      name: "mainnet",
      now: NOW_SECONDS,
      stakingContract: STAKING_CONTRACT,
      starkscanBase: STARKSCAN_BASE,
      tokens: tokens.map(({ address, decimals, id, name, networkId, symbol }) => ({
        address,
        decimals,
        id,
        name,
        networkId,
        symbol,
      })),
    },
  ];
};

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`: `.jsonl`, so the formatter never reflows generated data
 * and the file stays one line per case.
 */
export const renderStakingParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["context", await computeContext()],
    ["coverage", computeCoverage()],
    ["decode", computeDecodes()],
    ["verify", computeVerdicts()],
    ["overview", await computeOverviews()],
    ["directory", await computeDirectory()],
    ["positions", await computePositions()],
    ["action", await computeActions()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
