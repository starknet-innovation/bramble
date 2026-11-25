/**
 * The mobile core's gasless fees (wallet-core P14), pinned by `extension-gasless.jsonl`: the
 * SNIP-9 v2 hashes starknet.js and Krusty give, the wallet's checks on a gateway-built outside
 * execution and what it posts, the fee offers, and how each paymaster reply is judged. This fails
 * when the committed fixture is no longer what the extension's code produces: re-run
 * `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  GASLESS_PARITY_FIXTURE_PATH,
  renderGaslessParity,
} from "../../scripts/mobile-parity-gasless";

describe("mobile gasless parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(GASLESS_PARITY_FIXTURE_PATH, "utf8")).toBe(await renderGaslessParity());
  });
});
