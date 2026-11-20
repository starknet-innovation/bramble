/**
 * The mobile core's Activity fee and value at submission (wallet-core P2), pinned by
 * `extension-activity-detail.jsonl`: what the extension reads from a receipt, which rows
 * reconciliation reads a fee for, which stored rows it accepts, what the send path prices, and
 * what the expanded row shows. This fails when the committed fixture is no longer what the
 * extension's code produces: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  ACTIVITY_PARITY_FIXTURE_PATH,
  renderActivityParity,
} from "../../scripts/mobile-parity-activity";

describe("mobile activity parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(ACTIVITY_PARITY_FIXTURE_PATH, "utf8")).toBe(await renderActivityParity());
  });
});
