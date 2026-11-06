/**
 * `bun run scripts/ledger-e2e-results.ts <model ...>`: after
 * `test:e2e:ledger`, proves from each model's Playwright JSON report
 * (`test-results/ledger-<model>.json`, written by `playwright.ledger.config.ts`)
 * that tests ran and every one passed. A zero exit code alone would also
 * accept a run whose tests were all skipped. Fails on a missing or unreadable
 * report, no passed test, or any skipped, flaky or failed test.
 */
import { readFile } from "node:fs/promises";

const count = (stats: Record<string, unknown>, key: string): number =>
  typeof stats[key] === "number" ? stats[key] : Number.NaN;

/**
 * Why one model's Playwright JSON report does not prove a real, fully passing
 * run; empty when it does. Pure, so every rejected shape is unit-tested.
 */
export const ledgerResultFailures = (model: string, report: unknown): readonly string[] => {
  const root = typeof report === "object" && report !== null ? report : {};
  const stats = "stats" in root && typeof root.stats === "object" && root.stats !== null;
  if (!stats) {
    return [`${model}: the Playwright report has no stats`];
  }
  const numbers = (root as { stats: Record<string, unknown> }).stats;
  const failures: string[] = [];
  if (!(count(numbers, "expected") > 0)) {
    failures.push(`${model}: no test passed`);
  }
  for (const key of ["unexpected", "skipped", "flaky"]) {
    if (count(numbers, key) !== 0) {
      failures.push(`${model}: ${key} tests: ${String(numbers[key])}`);
    }
  }
  if ("errors" in root && Array.isArray(root.errors) && root.errors.length > 0) {
    failures.push(`${model}: the run reported ${root.errors.length} error(s)`);
  }
  return failures;
};

if (import.meta.main) {
  const models = process.argv.slice(2);
  const failures: string[] =
    models.length === 0 ? ["name at least one model, e.g. nanosp flex"] : [];
  for (const model of models) {
    const path = `test-results/ledger-${model}.json`;
    try {
      failures.push(...ledgerResultFailures(model, JSON.parse(await readFile(path, "utf8"))));
    } catch {
      failures.push(`${model}: no readable Playwright report at ${path}`);
    }
  }
  if (failures.length > 0) {
    console.error(`ledger-e2e-results: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log(`ledger-e2e-results: every test ran and passed for ${models.join(", ")}`);
}
