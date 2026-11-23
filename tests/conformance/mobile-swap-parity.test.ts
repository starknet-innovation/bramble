/**
 * The mobile core's AVNU swap (wallet-core P11), pinned by `extension-swap.jsonl`: the quotes the
 * real handler shows or refuses, the builds it prepares (and what reaches the signer and the
 * activity log) or refuses, and the reviewed floor. This fails when the committed fixture is no
 * longer what the extension's code produces: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderSwapParity, SWAP_PARITY_FIXTURE_PATH } from "../../scripts/mobile-parity-swap";

describe("mobile swap parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(SWAP_PARITY_FIXTURE_PATH, "utf8")).toBe(await renderSwapParity());
  });
});
