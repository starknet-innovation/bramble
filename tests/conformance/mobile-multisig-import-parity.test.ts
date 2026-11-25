/**
 * The Rust core's multisig import and call review (wallet-core's P1 `send::multisig_import` and
 * `send::multisig_review`) are pinned by G7g's `extension-multisig-import.jsonl`: packages through
 * the background's import handler, the intent replacement rule, and the multisig call review's
 * summaries and refusals. This fails when the committed fixture is no longer what the extension's
 * code produces: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  MULTISIG_IMPORT_FIXTURE_PATH,
  renderMultisigImportParity,
} from "../../scripts/mobile-parity-multisig-import";

describe("mobile multisig import parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(MULTISIG_IMPORT_FIXTURE_PATH, "utf8")).toBe(
      await renderMultisigImportParity(),
    );
    // About 3 s locally (a Krusty signature and a canned-node preparation per intent).
  }, 30_000);
});
