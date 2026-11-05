/**
 * Sepolia verification (issue 821, step 6): drives the built extension through
 * every in-wallet import path against the live Sepolia fixtures in
 * manifest/sepolia/, and scores what the wallet shows against the scope doc's
 * "Now" line for each TA card (the doc's "Desired" line rides along, unscored).
 * Read-only: no deploy, send or signature. Secrets are typed into the UI only;
 * the output carries addresses and visible text, and errors are redacted.
 * Ledger (TA-32…TA-38) needs the device and stays a manual check.
 *
 * Run from the repository root after `bun run build`:
 *   BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia \
 *     bun tools/vendor-dataset/verify-sepolia.ts [out.json] [previous.json]
 * With a previous scorecard, the verdicts that changed are listed at the end.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { NETWORK } from "./matrix-lib";
import { sepoliaSecret } from "./sepolia-seeds";
import { type Result, runChecks, type Verdict } from "./verify-sepolia-checks";
import { openSession } from "./verify-sepolia-ui";

if (NETWORK !== "sepolia") throw new Error("set BRAMBLE_DATASET_NETWORK=sepolia");

const OUT_PATH = resolve(process.argv[2] ?? resolve(tmpdir(), "bramble-sepolia-verification.json"));
const PREVIOUS = process.argv[3];

const session = await openSession(sepoliaSecret("S-BRM"));
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
  return `${r.verdict}: ${what}${why}`.slice(0, 200);
};
const scorecard = {
  ranAt: new Date().toISOString(),
  version,
  network: "SN_SEPOLIA",
  results: Object.fromEntries(results.map((r) => [`${r.ta} ${r.path}`, shown(r)])),
};
writeFileSync(OUT_PATH, `${JSON.stringify(scorecard, null, 2)}\n`);
console.log(`written: ${OUT_PATH}`);

if (PREVIOUS && existsSync(PREVIOUS)) {
  const before = JSON.parse(readFileSync(PREVIOUS, "utf8")) as {
    results: Record<string, string>;
  };
  const verdictOf = (line: string | undefined): string => line?.split(":")[0] ?? "new";
  console.log("\nchanged since the previous scorecard:");
  for (const [key, line] of Object.entries(scorecard.results)) {
    const was = verdictOf(before.results[key]);
    if (was !== verdictOf(line)) console.log(`   ${key}: ${was} → ${verdictOf(line)}`);
  }
}
