/**
 * Enforces a global unit-test coverage floor.
 *
 * Bun's `bunfig.toml` `coverageThreshold` is applied PER FILE in the pinned Bun
 * release, so it cannot express a single repository-wide floor: entrypoint and
 * E2E-driven UI modules are intentionally not unit-covered and would fail any
 * positive per-file threshold. This gate instead runs the suite with coverage
 * and asserts the aggregate ("All files") line and function percentages stay at
 * or above the floor. The floor sits just below the measured baseline
 * (functions 96.19%, lines 97.45%) so it guards against regressions without
 * being flaky. Coverage is only computed here, never during the fast offline
 * `bun test` gate.
 */
import process from "node:process";

const MIN_FUNCTION_PERCENT = 95;
const MIN_LINE_PERCENT = 95;

const child = Bun.spawn(["bun", "test", "./tests", "--coverage"], {
  stderr: "pipe",
  stdout: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
const output = `${stdout}${stderr}`;
process.stdout.write(output);

if (exitCode !== 0) {
  console.error(`Test run failed with exit code ${exitCode}; coverage floor not evaluated.`);
  process.exit(1);
}

const summary = output
  .split("\n")
  .map((line) => line.trim())
  .find((line) => line.startsWith("All files"));
if (!summary) {
  console.error("Could not find the coverage summary row.");
  process.exit(1);
}

const columns = summary.split("|").map((column) => column.trim());
const functionPercent = Number(columns[1]);
const linePercent = Number(columns[2]);
if (!Number.isFinite(functionPercent) || !Number.isFinite(linePercent)) {
  console.error(`Could not parse coverage percentages from: ${summary}`);
  process.exit(1);
}

const failures: string[] = [];
if (functionPercent < MIN_FUNCTION_PERCENT) {
  failures.push(`function coverage ${functionPercent}% is below floor ${MIN_FUNCTION_PERCENT}%`);
}
if (linePercent < MIN_LINE_PERCENT) {
  failures.push(`line coverage ${linePercent}% is below floor ${MIN_LINE_PERCENT}%`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.error(
  `Coverage floor met: functions ${functionPercent}% >= ${MIN_FUNCTION_PERCENT}%, ` +
    `lines ${linePercent}% >= ${MIN_LINE_PERCENT}%.`,
);
