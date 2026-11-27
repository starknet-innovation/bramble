/**
 * G7g: P1's import and call-summary cases that G5 left to mechanism tests, from the extension's
 * own code, for wallet-core's `send::multisig_import` and `send::multisig_review`:
 *
 * - `setup` (one line): the multisig record, its members (public keys and GUIDs), the vault
 *   accounts the wallet holds and the contact it saved; every other line is run against these;
 * - `import`: a package through the background's `wallet.importArgentMultisigIntent` handler, with
 *   the authority and nonce the chain answered and the registry before and after: accepted (with
 *   `feeReview`), authority and nonce mismatches, the remote summary replaced by the review, the
 *   review refusing, a stored intent under the id for another transaction or snapshot, merges over
 *   each local state (a complete package over a different partial is capped at the threshold,
 *   Bramble #1003), explicit `null` in optional keys, remote lifecycle claims dropped, the package
 *   envelope, and a locked wallet, another network, an unknown multisig;
 * - `signature`: one signature through `wallet.importArgentMultisigSignature` against a stored
 *   intent: accepted, reaching the threshold, non-member, duplicate, unverifiable, over another
 *   hash, an unknown intent, an intent past collecting, stale authority or nonce, a locked wallet
 *   and malformed messages;
 * - `replace`: `canReplaceArgentMultisigSigningIntent` over the transitions G5 does not pin;
 * - `review`: `reviewArgentMultisigCalls` over approve, unlimited approve, AVNU swap, staking,
 *   unknown and multicall batches, the summary cut, signer-change self-calls and poisoned payees.
 *
 * A line with a `divergence` pins the extension's answer where wallet-core differs or a fix is
 * pending; it needs a decision, not a port. G5's 2-of-3 Sepolia multisig of the published E2E
 * phrase, its canned node and Krusty's RFC-6979 signatures, so every run is identical. Left out:
 * the session check's timing, the registry's capacity, and a signature import with the chain nonce
 * ahead (its receipt lookup needs a node). `bun run mobile:parity` writes it;
 * `tests/conformance/mobile-multisig-import-parity.test.ts` fails on drift.
 */
import { CONTACT } from "../mobile-parity-calls/shared";
import { computeImports } from "./import";
import { computeReplacements } from "./replace";
import { computeReviews } from "./review";
import { loadSetup } from "./shared";
import { computeSignatureImports } from "./signatures";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const MULTISIG_IMPORT_FIXTURE_PATH =
  "mobile/core/tests/fixtures/extension-multisig-import.jsonl";

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`.
 */
export const renderMultisigImportParity = async (): Promise<string> => {
  const setup = await loadSetup();
  const header = {
    contact: CONTACT,
    name: "the wallet every case runs in",
    record: setup.record,
    signers: setup.signers.map(({ privateKey: _secret, ...signer }) => signer),
    vaultAccounts: setup.vaultAccounts,
  };
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["setup", [header]],
    ["import", await computeImports(setup)],
    ["signature", await computeSignatureImports(setup)],
    ["replace", await computeReplacements(setup)],
    ["review", await computeReviews(setup)],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
