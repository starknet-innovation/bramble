/**
 * The mobile core's Starknet name lookup (wallet-core P5), pinned by `extension-stark-name.jsonl`:
 * which typed names the extension looks up, the `domain_to_address` call it sends, and how it
 * reads one endpoint's reply. This fails when the committed fixture is no longer what the
 * extension's code produces: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  renderStarkNameParity,
  STARK_NAME_PARITY_FIXTURE_PATH,
} from "../../scripts/mobile-parity-stark-name";

describe("mobile Starknet name parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(STARK_NAME_PARITY_FIXTURE_PATH, "utf8")).toBe(
      await renderStarkNameParity(),
    );
  });
});
