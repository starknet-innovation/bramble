/**
 * CI helper for the Ledger E2E workflow (`.github/workflows/ledger-e2e.yml`).
 *
 * - `require [model ...]`: fails while any requested model's binary hash in
 *   `scripts/ledger-app-pins.ts` is unrecorded, saying how to record it. Reads
 *   only the pins, so it runs before any download or build.
 * - `record [model ...]`: after `bun run vendor:ledger-app`, prints a Markdown
 *   report of each built binary's SHA-256 for a maintainer to review. It runs
 *   no test, and fails if a binary is missing or differs from its record.
 *
 * Models default to every pinned model. Nothing here writes the pins: hashes
 * are recorded only by a reviewed commit.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { LEDGER_APP_BINARIES, ledgerAppBinaryPath } from "./ledger-app-pins";
import { ledgerHashReport, unrecordedLedgerModels } from "./ledger-app-policy";

type Model = keyof typeof LEDGER_APP_BINARIES;

const fail = (message: string): never => {
  console.error(`ledger-app-hashes: ${message}`);
  process.exit(1);
};

const [mode, ...requested] = process.argv.slice(2);
const models = (requested.length > 0 ? requested : Object.keys(LEDGER_APP_BINARIES)) as Model[];
for (const model of models) {
  if (!Object.hasOwn(LEDGER_APP_BINARIES, model)) {
    fail(`unknown model ${model}; expected one of ${Object.keys(LEDGER_APP_BINARIES).join(", ")}`);
  }
}

if (mode === "require") {
  const unrecorded = unrecordedLedgerModels(LEDGER_APP_BINARIES, models);
  if (unrecorded.length > 0) {
    fail(
      `the Ledger app binary hash is not recorded for ${unrecorded.join(", ")} in ` +
        "scripts/ledger-app-pins.ts, so the Speculos suite cannot run and this run fails. " +
        "A maintainer runs the Ledger E2E workflow with record_hashes=true, reviews the " +
        "printed SHA-256s, and commits them in a reviewed pull request " +
        "(tests/e2e/ledger/README.md).",
    );
  }
  console.log(`ledger-app-hashes: recorded for ${models.join(", ")}`);
} else if (mode === "record") {
  const rows = await Promise.all(
    models.map(async (model) => {
      const path = ledgerAppBinaryPath(model);
      const digest = (await Bun.file(path).exists())
        ? createHash("sha256")
            .update(await readFile(path))
            .digest("hex")
        : null;
      return { digest, model, recorded: LEDGER_APP_BINARIES[model].sha256 };
    }),
  );
  const report = ledgerHashReport(rows);
  console.log(report.markdown);
  if (!report.complete) {
    fail("a binary is missing or differs from its recorded hash");
  }
} else {
  fail("usage: bun run scripts/ledger-app-hashes.ts require|record [nanosp|flex|stax ...]");
}
