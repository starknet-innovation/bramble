/**
 * The mobile core's account rules (family addresses, nicknames, truncation, labels, group ids, and
 * discovery row wording) are pinned to the extension by `accounts-parity-families-{mainnet,sepolia}.json`
 * and `accounts-parity-rules.json`; the recovery scan (shapes, creatable and keep rules, scan target,
 * signing verdicts, privacy-pool note) by `accounts-parity-scan.json` and
 * `accounts-parity-scan-signing.json`.
 * This fails when the committed fixtures no longer match what the extension computes: re-run
 * `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  ACCOUNTS_PARITY_FIXTURE_PATHS,
  computeAccountParity,
} from "../../scripts/mobile-parity-accounts";
import { ACCOUNTS_SCAN_FIXTURE_PATHS, computeScanParity } from "../../scripts/mobile-parity-scan";

describe("mobile account parity", () => {
  test("the committed account fixtures are what the extension computes today", async () => {
    const expected = JSON.parse(JSON.stringify(await computeAccountParity())) as Record<
      keyof typeof ACCOUNTS_PARITY_FIXTURE_PATHS,
      unknown
    >;
    for (const part of ["familiesMainnet", "familiesSepolia", "recovery", "rules"] as const) {
      const fixture = JSON.parse(
        await readFile(ACCOUNTS_PARITY_FIXTURE_PATHS[part], "utf8"),
      ) as unknown;
      expect(fixture).toEqual(expected[part]);
    }
  });

  test("the committed recovery-scan fixtures are what the extension computes today", async () => {
    const expected = JSON.parse(JSON.stringify(await computeScanParity())) as Record<
      keyof typeof ACCOUNTS_SCAN_FIXTURE_PATHS,
      unknown
    >;
    for (const part of ["scan", "signing"] as const) {
      const fixture = JSON.parse(
        await readFile(ACCOUNTS_SCAN_FIXTURE_PATHS[part], "utf8"),
      ) as unknown;
      expect(fixture).toEqual(expected[part]);
    }
  });
});
