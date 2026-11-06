/**
 * Browser driving for the Sepolia verification run (verify-sepolia.ts): one
 * fresh extension profile, onboarded with S-BRM on mainnet (first run is
 * mainnet only), then switched to Sepolia, where every in-wallet import path
 * (P2…P8, P10) is driven through the side panel exactly as a person would.
 * Read-only: nothing here deploys, sends or signs. Secrets are typed into the
 * UI and never returned; scraped rows carry addresses and visible text only.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { type LoadedExtension, launchExtension } from "../../tests/e2e/extension-fixture";
import { sendRuntimeMessage } from "../../tests/e2e/wallet-helpers";

const PASSPHRASE = "dataset verification passphrase";
const SCAN_TIMEOUT_MS = 300_000;
const STEP_TIMEOUT_MS = 60_000;

/** One account row as the UI lists it (scan groups and the Ready key picker share the markup). */
export type Row = {
  readonly group: string;
  readonly address: string;
  readonly title: string;
  readonly hint: string;
  readonly selectable: boolean;
};

/** Every row under `scope`, opening closed scan groups first. */
const scrapeRows = async (scope: Locator, group: string): Promise<Row[]> => {
  const items = scope.locator("li.allowance-row");
  const rows: Row[] = [];
  for (let i = 0; i < (await items.count()); i += 1) {
    const row = items.nth(i);
    rows.push({
      group,
      address: (await row.locator("code").getAttribute("title")) ?? "",
      title: ((await row.locator("strong").textContent()) ?? "").trim(),
      hint: ((await row.locator("span.hint").textContent()) ?? "").trim(),
      selectable: await row.locator("input.select-check").isEnabled(),
    });
  }
  return rows;
};

/** The scan view's rows across the Bramble, Ready and Braavos groups. */
export const scanRows = async (page: Page): Promise<Row[]> => {
  const rows: Row[] = [];
  for (const group of ["openzeppelin", "argent", "braavos"]) {
    const details = page.locator(`[data-recovery-group="${group}"]`);
    if ((await details.count()) === 0) continue;
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await details.locator("summary").click();
    }
    rows.push(...(await scrapeRows(details, group)));
  }
  return rows;
};

/**
 * Types a seed, phrase or key into `field`. A failure is replaced by one that
 * names the field only: Playwright's own error may echo the value it typed.
 */
const fillSecret = async (locator: Locator, value: string, field: string): Promise<void> => {
  try {
    await locator.fill(value);
  } catch {
    throw new Error(`could not enter the ${field}`);
  }
};

const text = async (locator: Locator): Promise<string> =>
  ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim();

// The public Sepolia node rate-limits bursts; these answers mean "ask again".
const TRANSIENT = /rate limit|refused this request|Couldn.t check this account|Try again\.$/;
const RETRIES = 3;
const BACKOFF_MS = 20_000;

/**
 * Presses `search` and returns the final answer `locator` shows: past the
 * "Checking…" stage, and changed from `before` (a repeated answer reads the
 * same, so after 15 s the current text is taken). A rate-limit answer is
 * retried after a pause, up to RETRIES times.
 */
const answer = async (locator: Locator, search: () => Promise<void>): Promise<string> => {
  let last = "";
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const before = await text(locator);
    await search();
    await expect
      .poll(
        async () => {
          const now = await text(locator);
          return now !== "" && !now.startsWith("Checking") && now !== before;
        },
        { timeout: STEP_TIMEOUT_MS },
      )
      .toBe(true)
      .catch(() => undefined);
    last = await text(locator);
    if (!TRANSIENT.test(last)) return last;
    await new Promise((done) => setTimeout(done, BACKOFF_MS));
  }
  return last;
};

/** A launched profile holding S-BRM, switched to Sepolia, with helpers for each import path. */
export type Session = {
  readonly close: () => Promise<void>;
  /** P2 (a foreign phrase) or P3 (`null`: this wallet's own phrase); the page stays on the scan. */
  readonly scan: (mnemonic: string | null) => Promise<{ page: Page; status: string; rows: Row[] }>;
  /** P4 on a scan page: paste `address`, return the finder's answer and the rows after it. */
  readonly paste: (page: Page, address: string) => Promise<{ message: string; rows: Row[] }>;
  /** P5 on a scan page: search one manual index. */
  readonly manualIndex: (page: Page, index: number) => Promise<{ message: string; rows: Row[] }>;
  /** P6/P7/P8 private-key import; imports only for `openzeppelin` (P6), else stops at the picker. */
  readonly key: (input: {
    readonly type: "openzeppelin" | "argent";
    readonly key: string;
    readonly salt?: string;
    readonly address?: string;
  }) => Promise<{ message: string; rows: Row[]; finder?: string; imported: string[] }>;
  /** P10: add a multisig by address. */
  readonly multisig: (address: string) => Promise<{ message: string }>;
  /** What the phrase screen says when `mnemonic` is entered (for 15/18/21 words). */
  readonly phraseEntry: (mnemonic: string) => Promise<{ message: string; searchable: boolean }>;
};

const accountsOf = async (page: Page): Promise<string[]> => {
  const status = await sendRuntimeMessage<{ accounts?: readonly { address: string }[] }>(page, {
    type: "wallet.status",
  });
  return (status?.accounts ?? []).map(({ address }) => `0x${BigInt(address).toString(16)}`);
};

/** Onboards `mnemonic` on mainnet, keeping Bramble account 0, then switches to Sepolia. */
export async function openSession(mnemonic: string): Promise<Session> {
  const loaded: LoadedExtension = await launchExtension({ headless: true });
  const base = `chrome-extension://${loaded.extensionId}`;
  const onboarding = await loaded.context.newPage();
  await onboarding.goto(`${base}/onboarding.html`);
  await onboarding.getByRole("button", { name: "Add an existing wallet" }).click();
  await onboarding.getByRole("button", { name: "Recovery phrase" }).click();
  await fillSecret(onboarding.locator('input[name="import-word-0"]'), mnemonic, "recovery phrase");
  await onboarding.getByRole("button", { name: "Continue" }).click();
  await onboarding.locator('input[name="vaultPassphrase"]').fill(PASSPHRASE);
  await onboarding.locator('input[name="vaultPassphraseConfirm"]').fill(PASSPHRASE);
  await onboarding.getByRole("button", { name: "Find my accounts" }).click();
  await expect(onboarding.locator("#recovery-scan-status")).toContainText("Search complete", {
    timeout: SCAN_TIMEOUT_MS,
  });
  // Mainnet is empty for the Sepolia seeds, so nothing starts ticked.
  await onboarding.locator('[data-recovery-group="openzeppelin"] summary').click();
  await onboarding
    .locator('[data-recovery-group="openzeppelin"] input.select-check')
    .first()
    .check();
  await onboarding.locator("#recover-accounts-button").click();
  await expect.poll(() => onboarding.isClosed(), { timeout: STEP_TIMEOUT_MS }).toBe(true);

  const panel = await loaded.context.newPage();
  await panel.goto(`${base}/sidepanel.html`);
  await sendRuntimeMessage(panel, { networkId: "SN_SEPOLIA", type: "wallet.setActiveNetwork" });
  const network = await sendRuntimeMessage<{ networkId?: string }>(panel, {
    type: "wallet.status",
  });
  if (network?.networkId !== "SN_SEPOLIA") throw new Error("could not switch to Sepolia");

  // A fresh side panel on the add-account chooser, then down through `kinds`.
  const open = async (kinds: readonly string[]): Promise<Page> => {
    await panel.goto(`${base}/sidepanel.html`);
    await panel.locator('[data-view="settings"]').first().click();
    await panel.locator('[data-view="account"]').first().click();
    await panel.locator("#new-account").click();
    for (const kind of kinds) await panel.locator(`[data-add-kind="${kind}"]`).click();
    return panel;
  };

  const scan: Session["scan"] = async (phrase) => {
    const page = await open(["import", phrase === null ? "find-accounts" : "import-phrase"]);
    if (phrase !== null) {
      await fillSecret(page.locator('input[name="import-word-0"]'), phrase, "recovery phrase");
      await page.locator("#import-phrase-search").click();
    }
    if (phrase === null) await page.locator("#find-accounts-search").click();
    const status = page.locator("#recovery-scan-status");
    for (let attempt = 0; ; attempt += 1) {
      // A stopped search leaves the retry control enabled again (it is busy
      // while one runs): a refusal, or a node error page the wallet could not parse.
      await page.waitForTimeout(2_000);
      await expect
        .poll(
          async () => {
            const now = await text(status);
            if (now.includes("Search complete")) return true;
            if (now === "" || now === "Ready to search.") return false;
            return page.locator("#recovery-scan-retry").isEnabled();
          },
          { timeout: SCAN_TIMEOUT_MS },
        )
        .toBe(true);
      if ((await text(status)).includes("Search complete") || attempt === RETRIES) break;
      await new Promise((done) => setTimeout(done, BACKOFF_MS));
      await page.locator("#recovery-scan-retry").click();
    }
    const outcome = await text(status);
    if (!outcome.includes("Search complete")) throw new Error(`scan stopped: ${outcome}`);
    return { page, status: outcome, rows: await scanRows(page) };
  };

  const paste: Session["paste"] = async (page, address) => {
    const finder = page.locator('[data-recovery-address="recovery"]');
    if (!(await finder.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await finder.locator("summary").click();
    }
    await page.locator('input[name="recoveryAddress"]').fill(address);
    const message = await answer(page.locator("#recovery-address-result"), () =>
      page.locator("#recovery-address-search").click(),
    );
    return { message, rows: await scanRows(page) };
  };

  const manualIndex: Session["manualIndex"] = async (page, index) => {
    const input = page.locator('input[name="recoveryManualIndex"]');
    if (!(await input.isVisible()))
      await input.locator("xpath=ancestor::details[1]/summary").click();
    await input.fill(String(index));
    const message = await answer(page.locator("#recovery-accounts-result"), () =>
      page.locator("#recovery-manual-search").click(),
    );
    return { message, rows: await scanRows(page) };
  };

  const key: Session["key"] = async ({ type, key: raw, salt, address }) => {
    const page = await open(["import", "import-key"]);
    const before = await accountsOf(page);
    await page.locator('select[name="accountContractType"]').selectOption(type);
    await fillSecret(page.locator('textarea[name="rawKey"]'), raw, "private key");
    if (salt) await page.locator('input[name="deploymentSalt"]').fill(salt);
    await page.locator('#import-key-form button[type="submit"]').click();
    const result = page.locator("#import-key-result");
    const picker = page.locator("[data-ready-key-picker]");
    if (type === "openzeppelin") {
      await page.waitForTimeout(5_000);
      const after = await accountsOf(page);
      return {
        message: await text(result),
        rows: [],
        imported: after.filter((a) => !before.includes(a)),
      };
    }
    await expect
      .poll(async () => (await picker.count()) > 0 || (await text(result)) !== "", {
        timeout: STEP_TIMEOUT_MS,
      })
      .toBe(true);
    const rows = (await picker.count()) > 0 ? await scrapeRows(picker, "ready-key") : [];
    const message = await text(result);
    if (!address) return { message, rows, imported: [] };
    const finder = page.locator('[data-recovery-address="key"]');
    await finder.locator("summary").click();
    await page.locator('input[name="keyAddress"]').fill(address);
    const found = await answer(page.locator("#key-address-result"), () =>
      page.locator("#key-address-search").click(),
    );
    return { message, rows, finder: found, imported: [] };
  };

  const multisig: Session["multisig"] = async (address) => {
    await panel.goto(`${base}/sidepanel.html`);
    await panel.locator('[data-view="settings"]').first().click();
    await panel.locator('[data-view="multisigs"]').first().click();
    await panel.locator('[data-view="multisig-watch"]').first().click();
    await panel.locator('#multisig-add-form input[name="address"]').fill(address);
    await panel.locator('#multisig-add-form button[type="submit"]').click();
    // The outcome arrives as a toast; success also navigates to the multisig.
    const toast = panel
      .locator(".toast-stack .toast")
      .filter({ hasText: /multisig/i })
      .last();
    await expect(toast).toBeVisible({ timeout: STEP_TIMEOUT_MS });
    return { message: await text(toast) };
  };

  const phraseEntry: Session["phraseEntry"] = async (phrase) => {
    const page = await open(["import", "import-phrase"]);
    await fillSecret(page.locator('input[name="import-word-0"]'), phrase, "recovery phrase");
    await page.waitForTimeout(500);
    return {
      message: await text(page.locator("#recovery-result")),
      searchable: await page.locator("#import-phrase-search").isEnabled(),
    };
  };

  return {
    close: () => loaded.close(),
    scan,
    paste,
    manualIndex,
    key,
    multisig,
    phraseEntry,
  };
}
