/**
 * Dataset verification: imports each vendor-dataset seed into the built wallet
 * (live mainnet, fresh profile per seed), lets the recovery scan finish, and
 * scrapes every candidate the UI lists. Output: a scorecard diffing reality
 * against the tools/vendor-dataset/manifest/ expectations. Prints addresses
 * only — seeds are read from the env file and typed straight into the UI.
 *
 * Run from the repository root after `bun run build`:
 *   BRAMBLE_E2E_LIVE_NETWORK=1 bun tools/vendor-dataset/verify-dataset.ts [out.json]
 * The scorecard goes to the given path, or to the system temp directory; copy a
 * run into this folder as a dated `verification-*.json` snapshot to keep it.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { launchExtension } from "../../tests/e2e/extension-fixture";
import { envSeed } from "./dataset-env";
import { loadManifest } from "./matrix-lib";

const OUT_PATH = resolve(
  process.argv[2] ?? resolve(tmpdir(), "bramble-vendor-dataset-verification.json"),
);
const SCAN_TIMEOUT_MS = 300_000;
const VAULT_PASSPHRASE = "dataset verification passphrase";

const SEEDS = [
  "BRAMBLE_DATASET_SEED_READY_MAIN",
  "BRAMBLE_DATASET_SEED_BRAAVOS_MAIN",
  "BRAMBLE_DATASET_SEED_READY_MATRIX",
  "BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX",
  "BRAMBLE_DATASET_SEED_GAPS",
] as const;

type Scraped = { group: string; address: string; title: string; hint: string };

const scrapeRecovery = async (page: Page): Promise<Scraped[]> => {
  const rows: Scraped[] = [];
  for (const group of ["openzeppelin", "argent", "braavos"]) {
    const details = page.locator(`[data-recovery-group="${group}"]`);
    if ((await details.count()) === 0) continue;
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await details.locator("summary").click();
    }
    const items = details.locator("li");
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      const row = items.nth(i);
      rows.push({
        group,
        address: (await row.locator("code").getAttribute("title")) ?? "",
        title: (await row.locator("strong").textContent()) ?? "",
        hint: (await row.locator("span.hint").textContent()) ?? "",
      });
    }
  }
  return rows;
};

const importAndScan = async (mnemonic: string): Promise<{ rows: Scraped[]; status: string }> => {
  const loaded = await launchExtension({ headless: true });
  try {
    const page = await loaded.context.newPage();
    await page.goto(`chrome-extension://${loaded.extensionId}/onboarding.html`);
    await expect(page.getByRole("button", { name: "Add an existing wallet" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Add an existing wallet" }).click();
    await page.getByRole("button", { name: "Recovery phrase" }).click();
    await page.locator('input[name="import-word-0"]').fill(mnemonic);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
    await page.locator('input[name="vaultPassphraseConfirm"]').fill(VAULT_PASSPHRASE);
    await page.getByRole("button", { name: "Find my accounts" }).click();
    await expect(page.getByRole("heading", { name: "Find your accounts" })).toBeVisible();
    await expect(page.locator("#recovery-scan-status")).toContainText("Search complete", {
      timeout: SCAN_TIMEOUT_MS,
    });
    const status = (await page.locator("#recovery-scan-status").textContent()) ?? "";
    const rows = await scrapeRecovery(page);
    return { rows, status };
  } finally {
    await loaded.close();
  }
};

const norm = (a: string): string => {
  try {
    return `0x${BigInt(a).toString(16)}`;
  } catch {
    return a.toLowerCase();
  }
};

const manifest = loadManifest();

const results: Record<string, { status: string; rows: Scraped[] }> = {};
for (const seedVar of SEEDS) {
  console.log(`\n### importing ${seedVar}`);
  try {
    const { rows, status } = await importAndScan(envSeed(seedVar));
    results[seedVar] = { status, rows };
    console.log(`   scan: ${status.trim()}`);
    for (const row of rows) {
      console.log(`   [${row.group}] ${row.title} ${norm(row.address)} — ${row.hint}`);
    }
  } catch (error) {
    results[seedVar] = { status: `ERROR: ${String(error).slice(0, 200)}`, rows: [] };
    console.log(`   FAILED: ${String(error).slice(0, 160)}`);
  }
}

// ── scorecard ──
console.log("\n──── scorecard ────");
const scorecard: Record<string, { found: boolean; detectability: string; note: string }> = {};
let found = 0;
let total = 0;
for (const entry of Object.values(manifest)) {
  const run = results[entry.seed];
  if (!run) continue;
  total += 1;
  const hit = run.rows.some((row) => norm(row.address) === norm(entry.address));
  if (hit) found += 1;
  scorecard[entry.id] = { found: hit, detectability: entry.detectability, note: entry.expected };
  console.log(`${hit ? "FOUND " : "missed"} [${entry.detectability}] ${entry.id}`);
}
console.log(`\n${found}/${total} dataset accounts surfaced by the current wallet`);
writeFileSync(OUT_PATH, JSON.stringify({ results, scorecard }, null, 2));
console.log(`written: ${OUT_PATH}`);
