/**
 * The Ledger E2E workflow's hash gate (scripts/ledger-app-hashes.ts): test mode
 * fails while a hash is unrecorded, and record mode reports hashes without
 * ever reading as a test result.
 */
import { describe, expect, test } from "bun:test";
import { LEDGER_APP_BINARIES } from "../../scripts/ledger-app-pins";
import { ledgerHashReport, unrecordedLedgerModels } from "../../scripts/ledger-app-policy";

const A = "a".repeat(64);
const B = "b".repeat(64);
const run = (args: string[]) =>
  Bun.spawnSync(["bun", "run", "scripts/ledger-app-hashes.ts", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });

describe("Ledger app hash gate", () => {
  test("lists only the requested models that are unrecorded", () => {
    const binaries = { flex: { sha256: null }, nanosp: { sha256: A }, stax: { sha256: null } };
    expect(unrecordedLedgerModels(binaries, ["nanosp", "flex"])).toEqual(["flex"]);
    expect(unrecordedLedgerModels(binaries, ["nanosp"])).toEqual([]);
  });

  test("CI test mode fails exactly while a tested model's hash is unrecorded", () => {
    const unrecorded = unrecordedLedgerModels(LEDGER_APP_BINARIES, ["nanosp", "flex"]);
    const result = run(["require", "nanosp", "flex"]);
    expect(result.exitCode).toBe(unrecorded.length > 0 ? 1 : 0);
    if (unrecorded.length > 0) {
      expect(result.stderr.toString()).toContain(`not recorded for ${unrecorded.join(", ")}`);
      expect(result.stderr.toString()).toContain("record_hashes=true");
    }
  });

  test("rejects an unknown mode or model", () => {
    expect(run(["verify"]).exitCode).toBe(1);
    expect(run(["require", "nanox"]).stderr.toString()).toContain("unknown model nanox");
  });

  test("record mode says no test ran and fails on a missing or changed binary", () => {
    const fresh = ledgerHashReport([
      { digest: A, model: "nanosp", recorded: null },
      { digest: B, model: "flex", recorded: B },
    ]);
    expect(fresh.complete).toBe(true);
    expect(fresh.markdown).toContain("record mode: no tests ran");
    expect(fresh.markdown).toContain(`| nanosp | \`${A}\` | unrecorded: review, then record |`);
    expect(fresh.markdown).toContain("matches the recorded hash");

    const missing = ledgerHashReport([{ digest: null, model: "stax", recorded: null }]);
    expect(missing.complete).toBe(false);
    expect(missing.markdown).toContain("MISSING");

    const changed = ledgerHashReport([{ digest: A, model: "flex", recorded: B }]);
    expect(changed.complete).toBe(false);
    expect(changed.markdown).toContain("DIFFERS");
  });

  test("record mode over an unbuilt checkout reports every model missing and fails", () => {
    const result = run(["record"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("| stax | `-` | MISSING: not built |");
  });
});
