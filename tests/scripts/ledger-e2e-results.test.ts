/**
 * The Ledger E2E results gate (scripts/ledger-e2e-results.ts): a zero exit is
 * not enough, so each model's Playwright report must show tests that ran and
 * passed, with nothing skipped, flaky or failed.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { ledgerResultFailures } from "../../scripts/ledger-e2e-results";

const passing = { errors: [], stats: { expected: 5, flaky: 0, skipped: 0, unexpected: 0 } };
const withStats = (stats: Record<string, unknown>) => ({
  ...passing,
  stats: { ...passing.stats, ...stats },
});

describe("Ledger E2E results gate", () => {
  test("accepts a run where every test ran and passed", () => {
    expect(ledgerResultFailures("nanosp", passing)).toEqual([]);
  });

  test("rejects a vacuous, skipped, flaky, failed or malformed run", () => {
    expect(ledgerResultFailures("flex", withStats({ expected: 0 }))).toEqual([
      "flex: no test passed",
    ]);
    expect(ledgerResultFailures("flex", withStats({ expected: 0, skipped: 5 }))).toEqual([
      "flex: no test passed",
      "flex: skipped tests: 5",
    ]);
    expect(ledgerResultFailures("flex", withStats({ flaky: 1 }))).toEqual(["flex: flaky tests: 1"]);
    expect(ledgerResultFailures("flex", withStats({ unexpected: 2 }))).toEqual([
      "flex: unexpected tests: 2",
    ]);
    expect(ledgerResultFailures("flex", withStats({ skipped: "0" }))).toEqual([
      "flex: skipped tests: 0",
    ]);
    expect(ledgerResultFailures("flex", { ...passing, errors: [{ message: "boom" }] })).toEqual([
      "flex: the run reported 1 error(s)",
    ]);
    expect(ledgerResultFailures("flex", null)).toEqual([
      "flex: the Playwright report has no stats",
    ]);
    expect(ledgerResultFailures("flex", { stats: null })).toEqual([
      "flex: the Playwright report has no stats",
    ]);
  });

  test("the CLI fails without a report or a model", () => {
    const run = (args: string[]) =>
      Bun.spawnSync(["bun", "run", "scripts/ledger-e2e-results.ts", ...args], { stderr: "pipe" });
    expect(run([]).exitCode).toBe(1);
    const missing = run(["no-such-model"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain("no readable Playwright report");
  });

  test("the Ledger config writes the per-model report the gate reads", async () => {
    const config = await readFile("playwright.ledger.config.ts", "utf8");
    expect(config).toContain('["json", { outputFile: `test-results/ledger-${MODEL}.json` }]');
  });
});
