/**
 * The mobile core's allowances (wallet-core P12), pinned by `extension-allowances.jsonl`: event
 * decoding, the merge and listing rules, retention, the log's writes and settling, recording a
 * submitted batch, the revoke call, and the external scan and tracked reads over a fake node.
 * This fails when the committed fixture is no longer what the extension's code produces:
 * re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  ALLOWANCES_PARITY_FIXTURE_PATH,
  renderAllowancesParity,
} from "../../scripts/mobile-parity-allowances";

describe("mobile allowances parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(ALLOWANCES_PARITY_FIXTURE_PATH, "utf8")).toBe(
      await renderAllowancesParity(),
    );
  });
});
