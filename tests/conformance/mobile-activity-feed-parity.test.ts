/**
 * The mobile core's Activity CSV export, filter, amount sort and per-counterparty summary
 * (wallet-core P10), pinned by `extension-activity-feed.jsonl` over one fixed feed. This fails
 * when the committed fixture is no longer what the extension's code produces: re-run
 * `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  ACTIVITY_FEED_FIXTURE_PATH,
  renderActivityFeedParity,
} from "../../scripts/mobile-parity-activity-feed";

describe("mobile activity feed parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(ACTIVITY_FEED_FIXTURE_PATH, "utf8")).toBe(renderActivityFeedParity());
  });
});
