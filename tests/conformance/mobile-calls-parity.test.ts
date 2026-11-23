/**
 * The mobile core's call review and batch submission (wallet-core P9, and P1's call summaries),
 * pinned by `extension-call-review.jsonl`: what `decodeCall` makes of each call, what
 * `verifyCalls` flags in each batch, what `submitInvokeTransaction` puts on the wire for a
 * multicall, and which batches the invoke path refuses. This fails when the committed fixture is
 * no longer what the extension's code produces: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CALLS_PARITY_FIXTURE_PATH, renderCallsParity } from "../../scripts/mobile-parity-calls";

describe("mobile call review parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(CALLS_PARITY_FIXTURE_PATH, "utf8")).toBe(await renderCallsParity());
  });
});
