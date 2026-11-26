/**
 * The mobile core's dapp connect (wallet-core P16), pinned by `extension-dapp.jsonl`: how a
 * page's requests are read and budgeted, connecting a site and the passive reads, origin grants,
 * the approval queue, the blocklist, site warnings and phishing feed, and typed data with its
 * outside-execution review. This fails when the committed fixture is no longer what the
 * extension's code produces: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { DAPP_PARITY_FIXTURE_PATH, renderDappParity } from "../../scripts/mobile-parity-dapp";

describe("mobile dapp parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(DAPP_PARITY_FIXTURE_PATH, "utf8")).toBe(await renderDappParity());
  }, 60_000);
});
