/**
 * The mobile core's custom RPC endpoints (wallet-core P4), pinned by
 * `extension-settings-parity.jsonl`: what `setRpcOverride` stores or refuses, the endpoint order
 * and explorer fallback that follow, how a stored override reads back, and `redactEndpoints`.
 * This fails when the committed fixture is no longer what the extension's code produces: re-run
 * `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  renderSettingsParity,
  SETTINGS_PARITY_FIXTURE_PATH,
} from "../../scripts/mobile-parity-settings";

describe("mobile settings parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(SETTINGS_PARITY_FIXTURE_PATH, "utf8")).toBe(await renderSettingsParity());
  });
});
