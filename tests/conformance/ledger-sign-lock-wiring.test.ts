/**
 * Sherlock 228, the half that lives in the panel's render cycle. The Ledger
 * device-sign takeover survives repaints and only `poll()` reconciles it with
 * the background queue, but a locked or vault-less status paints the gate and
 * returns before any poll runs. A lock rejects every parked request, so the
 * locked branch must take the takeover down itself, or the old hash and its
 * "approve on your device" prompt stay over the unlock screen.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const START = join(
  import.meta.dir,
  "../../packages/presentation/wallet-ui/src/sidepanel/app/start.ts",
);

describe("locked panel and the Ledger sign takeover", () => {
  test("the locked branch dismisses the takeover before it returns", async () => {
    const source = await readFile(START, "utf8");
    const branch = source.indexOf("if (!status.hasVault || status.locked) {");
    expect(branch).toBeGreaterThan(-1);
    const body = source.slice(branch, source.indexOf("return;", branch));
    expect(body).toContain("ledgerSign.dismiss();");
  });
});
