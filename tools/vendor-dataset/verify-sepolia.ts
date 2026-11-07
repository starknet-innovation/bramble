/**
 * Sepolia verification (issue 821, step 6): drives the built extension through
 * every in-wallet import path against the live Sepolia fixtures in
 * manifest/sepolia/, and scores what the wallet shows against the scope doc's
 * "Now" line for each TA card (the doc's "Desired" line rides along, unscored).
 * Read-only: no deploy, send or signature. Secrets are typed into the UI only;
 * the output carries addresses and visible text, and everything printed or
 * written, a failure included, is redacted (sepolia-redact).
 *
 * The test Ledger (TA-32…TA-37, path P9) is opt-in: BRAMBLE_SEPOLIA_LEDGER=1
 * shows the browser and adds those checks after the rest, asking in the
 * terminal for the device (verify-sepolia-ledger.ts). Without it they are
 * skipped, so the run needs no Ledger; the nightly never sets it. TA-38 stays
 * a manual check.
 *
 * Run from the repository root after `bun run build`:
 *   BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia \
 *     bun tools/vendor-dataset/verify-sepolia.ts [out.json] [previous.json]
 * With a previous scorecard, the verdicts that changed are listed at the end.
 * The scorecard goes to the given path, or to a new owner-only directory under
 * the system temp directory. The run exits non-zero when any check fails or
 * errors, so CI (the nightly) can gate on it.
 *
 * BRAMBLE_SEPOLIA_RECORD=<tape.json> records every network answer of a live
 * run; BRAMBLE_SEPOLIA_REPLAY=<tape.json> replays one with no network at all
 * (drop BRAMBLE_E2E_LIVE_NETWORK). See sepolia-tape.ts.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { NETWORK } from "./matrix-lib";
import { guarded, redact, secret } from "./sepolia-redact";
import { sepoliaSecret } from "./sepolia-seeds";
import { readTape, recordTape, replayTape, type Tape, writeTape } from "./sepolia-tape";
import { runChecks } from "./verify-sepolia-checks";
import { runLedgerChecks } from "./verify-sepolia-ledger";
import { allResults, type Result, type Verdict } from "./verify-sepolia-score";
import { openSession, type Session } from "./verify-sepolia-ui";

if (NETWORK !== "sepolia") throw new Error("set BRAMBLE_DATASET_NETWORK=sepolia");
// Playwright's debug logs echo every value typed, secrets included, before any redaction.
if (process.env["DEBUG"] || process.env["PWDEBUG"]) throw new Error("unset DEBUG and PWDEBUG");

const defaultOutPath = (): string =>
  join(mkdtempSync(join(tmpdir(), "bramble-sepolia-")), "verification.json");

const PREVIOUS = process.argv[3];
const RECORD = process.env["BRAMBLE_SEPOLIA_RECORD"];
const REPLAY = process.env["BRAMBLE_SEPOLIA_REPLAY"];
const LEDGER = process.env["BRAMBLE_SEPOLIA_LEDGER"] === "1";
if (RECORD && REPLAY)
  throw new Error("set BRAMBLE_SEPOLIA_RECORD or BRAMBLE_SEPOLIA_REPLAY, not both");

let clean = false;
let tapeKept = true;

/** Writes the recorded tape; a refusal is reported, never allowed to hide the run's own result. */
const keepTape = (path: string, tape: Tape): void => {
  try {
    writeTape(path, tape);
  } catch (error) {
    tapeKept = false;
    console.error(`tape not written: ${redact(String(error)).slice(0, 300)}`);
  }
};

const ok = await guarded(async () => {
  const OUT_PATH = resolve(process.argv[2] ?? defaultOutPath());
  let tape: Tape = REPLAY ? readTape(REPLAY) : {};
  let missing = new Set<string>();
  const network = REPLAY
    ? async (context: BrowserContext) => {
        missing = await replayTape(context, tape);
      }
    : RECORD
      ? async (context: BrowserContext) => {
          tape = await recordTape(context);
        }
      : undefined;
  let session: Session | undefined;
  let results: readonly Result[];
  try {
    session = await openSession(secret(sepoliaSecret("S-BRM")), network, LEDGER);
    await runChecks(session);
    if (LEDGER) await runLedgerChecks(session);
    else console.log("\n## Test Ledger (TA-32…TA-37): skipped; set BRAMBLE_SEPOLIA_LEDGER=1");
    results = allResults();
  } finally {
    await session?.close();
    // A partial tape is still worth keeping; writeTape refuses one carrying a secret.
    if (RECORD) keepTape(RECORD, tape);
  }
  if (missing.size) {
    console.log(`replay: ${missing.size} request(s) not on the tape, for example:`);
    for (const key of [...missing].slice(0, 5)) console.log(`   ${redact(key).slice(0, 200)}`);
  }

  const version = (() => {
    try {
      return JSON.parse(readFileSync("dist/manifest.json", "utf8")).version as string;
    } catch {
      return "unknown";
    }
  })();
  const count = (v: Verdict): number => results.filter((r) => r.verdict === v).length;
  clean = count("fail") === 0 && count("error") === 0;
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
process.exit(ok && clean && tapeKept ? 0 : 1);
