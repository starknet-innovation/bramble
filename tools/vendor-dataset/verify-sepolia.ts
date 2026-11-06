/**
 * Sepolia verification (issue 821, step 6): drives the built extension through
 * every in-wallet import path against the live Sepolia fixtures in
 * manifest/sepolia/, and scores what the wallet shows against the scope doc's
 * "Now" line for each TA card (the doc's "Desired" line rides along, unscored).
 * Read-only: no deploy, send or signature. Secrets are typed into the UI only;
 * the output carries addresses and visible text, and everything printed or
 * written, a failure included, is redacted (sepolia-redact).
 * Ledger (TA-32…TA-38) needs the device and stays a manual check.
 *
 * Run from the repository root after `bun run build`:
 *   BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia \
 *     bun tools/vendor-dataset/verify-sepolia.ts [out.json] [previous.json]
 * With a previous scorecard, the verdicts that changed are listed at the end.
 * The scorecard goes to the given path, or to a new owner-only directory under
 * the system temp directory.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NETWORK } from "./matrix-lib";
import { guarded, redact, secret } from "./sepolia-redact";
import { sepoliaSecret } from "./sepolia-seeds";
import { type Result, runChecks, type Verdict } from "./verify-sepolia-checks";
import { openSession } from "./verify-sepolia-ui";

if (NETWORK !== "sepolia") throw new Error("set BRAMBLE_DATASET_NETWORK=sepolia");
// Playwright's debug logs echo every value typed, secrets included, before any redaction.
if (process.env["DEBUG"] || process.env["PWDEBUG"]) throw new Error("unset DEBUG and PWDEBUG");

const defaultOutPath = (): string =>
  join(mkdtempSync(join(tmpdir(), "bramble-sepolia-")), "verification.json");

const PREVIOUS = process.argv[3];

const ok = await guarded(async () => {
  const OUT_PATH = resolve(process.argv[2] ?? defaultOutPath());
  const session = await openSession(secret(sepoliaSecret("S-BRM")));
  let results: Result[];
  try {
    results = await runChecks(session);
  } finally {
    await session.close();
  }

  const version = (() => {
    try {
      return JSON.parse(readFileSync("dist/manifest.json", "utf8")).version as string;
    } catch {
      return "unknown";
    }
  })();
  const count = (v: Verdict): number => results.filter((r) => r.verdict === v).length;
  console.log(
    `\n${count("pass")} pass · ${count("fail")} fail · ${count("review")} review · ${count("error")} error`,
  );
  // One line per check, "verdict: what the wallet showed", so a snapshot stays
  // small and diffs line by line; the cards hold the "Now"/"Desired" text.
  const shown = (r: Result): string => {
    const o = r.observed;
    const imported = o.imported === undefined ? "" : `imported: ${o.imported}`;
    const seen = o.message || o.hint || imported;
    const listed = o.listed === undefined ? "" : o.listed ? "listed" : "not listed";
    const what = [listed, seen].filter(Boolean).join(" · ");
    const why = r.mismatches.length ? ` [${r.mismatches.join(", ")}]` : "";
    // Redacted before the cut, so no part of a secret survives it.
    return redact(`${r.verdict}: ${what}${why}`).slice(0, 200);
  };
  // Every string value is redacted on its own, so the JSON stays well formed.
  const scorecard = {
    ranAt: new Date().toISOString(),
    version: redact(version),
    network: "SN_SEPOLIA",
    results: Object.fromEntries(results.map((r) => [`${r.ta} ${r.path}`, shown(r)])),
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(scorecard, null, 2)}\n`, { mode: 0o600 });
  console.log(redact(`written: ${OUT_PATH}`));

  if (PREVIOUS && existsSync(PREVIOUS)) {
    const before = JSON.parse(readFileSync(PREVIOUS, "utf8")) as {
      results: Record<string, string>;
    };
    const verdictOf = (line: string | undefined): string => line?.split(":")[0] ?? "new";
    console.log("\nchanged since the previous scorecard:");
    for (const [key, line] of Object.entries(scorecard.results)) {
      const was = verdictOf(before.results[key]);
      if (was !== verdictOf(line)) console.log(redact(`   ${key}: ${was} → ${verdictOf(line)}`));
    }
  }
});
// Exit explicitly: a failed run can leave the browser open.
process.exit(ok ? 0 : 1);
