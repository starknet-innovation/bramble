/**
 * The mobile core's native staking (wallet-core P13), pinned by `extension-staking.jsonl`:
 * Starkscan's coverage rule, directory and positions, the chain reads and their decoders and
 * verdicts, the rows the screens show, and each action's calls and review. This fails when the
 * committed fixture is no longer what the extension's code produces: re-run
 * `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  renderStakingParity,
  STAKING_PARITY_FIXTURE_PATH,
} from "../../scripts/mobile-parity-staking";

describe("mobile staking parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(STAKING_PARITY_FIXTURE_PATH, "utf8")).toBe(await renderStakingParity());
  });
});
