/**
 * Upgrading in place keeps the wallet: a profile seeded on the previous release
 * opens on this build with the same passphrase, accounts, names, network and
 * dapp connections, and its vault migrated to the current schema.
 *
 * Opt-in: set `BRAMBLE_E2E_PREVIOUS_BUILD` to an unzipped previous Chrome
 * release (`bun scripts/fetch-previous-release.ts <dir>`); otherwise the test is
 * reported skipped. The nightly workflow fetches it before the E2E gate.
 *
 * The manifest has no `key`, so Chromium derives the extension ID, and the
 * storage keyed by it, from the load path. Both builds are therefore loaded
 * from one staging directory into one profile, and the test asserts the ID
 * did not change. Seeding goes through the old build's UI only, as a user
 * would; nothing is written to storage directly.
 */
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decryptJson, isEncryptedEnvelope } from "@bramble/vault/encrypted-store";
import { CURRENT_SCHEMA_VERSION } from "@bramble/vault/schema";
import { VAULT_STORE_KEY } from "@bramble/vault/store-migration";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { expect, type Page, test, type Worker } from "@playwright/test";
import { launchExtension } from "./extension-fixture";
import { startTestDapp } from "./test-dapp-server";
import {
  IMPORT_MNEMONIC,
  importWalletFromPhrase,
  resolveConnectionApproval,
  unlockWallet,
  VAULT_PASSPHRASE,
} from "./wallet-helpers";

const previousBuild = process.env["BRAMBLE_E2E_PREVIOUS_BUILD"];
const distPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist");
const RENAMED = "Savings";

// A stuck click should fail on the step, not run out the long test timeout.
test.use({ actionTimeout: 15_000 });

// The schema version inside the stored vault. It is encrypted at rest, so the
// envelope is read from the worker's storage and opened here with the wallet's
// own decrypt and the suite's published test passphrase.
const storedSchemaVersion = async (worker: Worker): Promise<unknown> => {
  const envelope = await worker.evaluate(async (key) => {
    const storage = (
      globalThis as unknown as {
        chrome: { storage: { local: { get: (k: string) => Promise<Record<string, unknown>> } } };
      }
    ).chrome.storage.local;
    return (await storage.get(key))[key];
  }, VAULT_STORE_KEY);
  if (!isEncryptedEnvelope(envelope)) throw new Error("no encrypted vault in storage.local");
  const vault = await decryptJson(envelope, VAULT_PASSPHRASE, envelope.scope);
  return (vault as { schemaVersion?: unknown }).schemaVersion;
};

const accountRows = (sidepanel: Page) =>
  sidepanel.getByRole("dialog", { name: "Accounts" }).getByRole("listitem");

const openDrawer = async (sidepanel: Page): Promise<void> => {
  if ((await sidepanel.locator(".drawer-root").getAttribute("data-open")) !== "true") {
    await sidepanel.locator("#account-trigger").click();
  }
  await expect(sidepanel.getByRole("dialog", { name: "Accounts" })).toBeVisible();
};

const closeDrawer = async (sidepanel: Page): Promise<void> => {
  await sidepanel.getByRole("button", { name: "Close accounts" }).click();
  await expect(sidepanel.locator(".drawer-root")).not.toHaveAttribute("data-open", "true");
};

// Each drawer row's label and full address, in order, and which is selected.
// The short address shown is not compared: 0.10.11 pads it ("0x0208…98d9"
// where 0.10.10 showed "0x2083…98d9"). Both builds carry the full address in
// the row's title, canonicalized here so padding cannot differ either.
const accountSnapshot = async (sidepanel: Page) => {
  await openDrawer(sidepanel);
  const accounts = await accountRows(sidepanel)
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        address: button.querySelector("code")?.getAttribute("title") ?? "",
        label: button.querySelector("strong")?.textContent?.trim() ?? "",
        selected: button.getAttribute("aria-pressed") === "true",
      })),
    );
  await closeDrawer(sidepanel);
  // canonicalFelt("") is "0x0": a missing title must fail here, not compare equal.
  for (const { address } of accounts) expect(address).toMatch(/^0x[0-9a-fA-F]+$/);
  return accounts.map((account) => ({ ...account, address: canonicalFelt(account.address) }));
};

const openSettingsSection = async (sidepanel: Page, name: string): Promise<void> => {
  await sidepanel.getByRole("tab", { name: "Settings" }).click();
  await sidepanel.getByRole("tabpanel").getByRole("button", { name, exact: true }).click();
  await expect(sidepanel.getByRole("heading", { level: 1, name })).toBeVisible();
};

const seedOnPreviousBuild = async (sidepanel: Page, dappUrl: string, dappOrigin: string) => {
  await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC, VAULT_PASSPHRASE);

  await openDrawer(sidepanel);
  await sidepanel.locator("[data-drawer-network-toggle]").click();
  await sidepanel.getByRole("button", { name: "Starknet Sepolia" }).click();
  await expect(sidepanel.locator("#account-trigger")).toContainText("Sepolia");

  await openDrawer(sidepanel);
  const firstAccount = await sidepanel.locator("#account-trigger strong").innerText();
  await sidepanel.getByRole("button", { name: "Add account" }).click();
  await sidepanel.getByRole("button", { name: /^Regular account/ }).click();
  // The new account is selected once it exists; the drawer re-renders then.
  await expect(sidepanel.locator("#account-trigger strong")).not.toHaveText(firstAccount);
  await openDrawer(sidepanel);
  await expect(accountRows(sidepanel)).toHaveCount(2);
  await closeDrawer(sidepanel);

  await openSettingsSection(sidepanel, "Accounts & folders");
  const firstName = sidepanel.getByRole("textbox", { name: /^Name for / }).first();
  await firstName.fill(RENAMED);
  // Each account's field and Save button come in the same order.
  await sidepanel
    .getByRole("button", { name: /^Save name for / })
    .first()
    .click();
  await expect(sidepanel.getByText("Name saved")).toBeVisible();
  await sidepanel.getByRole("button", { name: "Back" }).click();

  const dapp = await sidepanel.context().newPage();
  await dapp.goto(dappUrl);
  await dapp.getByTestId("connect").click();
  await resolveConnectionApproval(sidepanel, dappOrigin, "approve");
  await expect(dapp.getByTestId("connect-result")).toContainText('"status":"resolved"');
  await dapp.close();
};

test("a wallet set up on the previous release survives the upgrade", async () => {
  test.skip(
    !previousBuild,
    "BRAMBLE_E2E_PREVIOUS_BUILD is unset (bun scripts/fetch-previous-release.ts <dir>)",
  );
  test.setTimeout(180_000);
  const previous = resolve(previousBuild ?? "");
  const previousVersion = JSON.parse(await readFile(join(previous, "manifest.json"), "utf8"))
    .version as string;
  const currentVersion = JSON.parse(await readFile(join(distPath, "manifest.json"), "utf8"))
    .version as string;
  test
    .info()
    .annotations.push({ description: `${previousVersion} -> ${currentVersion}`, type: "upgrade" });
  expect(
    previousVersion.localeCompare(currentVersion, "en", { numeric: true }),
    `${previousVersion} must not be newer than ${currentVersion}`,
  ).toBeLessThanOrEqual(0);
  const root = await mkdtemp(join(tmpdir(), "bramble-upgrade-"));
  const extensionPath = join(root, "extension");
  const userDataDir = join(root, "profile");
  await mkdir(userDataDir);
  const dappServer = await startTestDapp();
  try {
    await cp(previous, extensionPath, { recursive: true });
    const old = await launchExtension({ extensionPath, userDataDir });
    let seeded: Awaited<ReturnType<typeof accountSnapshot>>;
    try {
      const sidepanel = await old.openExtensionPage("sidepanel.html");
      await seedOnPreviousBuild(sidepanel, dappServer.url, dappServer.origin);
      seeded = await accountSnapshot(sidepanel);
      expect(seeded).toHaveLength(2);
      expect(seeded.map((account) => account.label)).toContain(RENAMED);
      const previousSchema = await storedSchemaVersion(old.serviceWorker);
      test
        .info()
        .annotations.push({ description: String(previousSchema), type: "previous vault schema" });
      expect(typeof previousSchema).toBe("number");
      expect(previousSchema as number).toBeLessThanOrEqual(CURRENT_SCHEMA_VERSION);

      // The update, through Chromium's own reload rather than a bare file swap.
      // Relaunching after a bare swap keeps the previous build's registered
      // worker script under the new pages (a command-line load never
      // re-registers it), which shows below as "Couldn't load connected sites".
      // Reloading unloads the extension and drops that registration. In this
      // headless browser it then stays unloaded until the relaunch below adds
      // it back from the command line, which registers the new worker.
      await rm(extensionPath, { force: true, recursive: true });
      await cp(distPath, extensionPath, { recursive: true });
      await old.serviceWorker
        .evaluate(() =>
          (
            globalThis as unknown as { chrome: { runtime: { reload: () => void } } }
          ).chrome.runtime.reload(),
        )
        .catch(() => undefined); // the worker may be gone before it answers
      // Unloaded once its pages no longer load.
      const probe = await old.context.newPage();
      await expect
        .poll(() =>
          probe.goto(`chrome-extension://${old.extensionId}/sidepanel.html`).then(
            () => "loaded",
            (error: Error) =>
              error.message.includes("ERR_BLOCKED_BY_CLIENT") ? "unloaded" : "other",
          ),
        )
        .toBe("unloaded");
    } finally {
      await old.close();
    }

    const oldId = old.extensionId;

    const upgraded = await launchExtension({ extensionPath, userDataDir });
    try {
      expect(upgraded.extensionId).toBe(oldId);
      const sidepanel = await upgraded.openExtensionPage("sidepanel.html");
      await expect(sidepanel.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      await unlockWallet(sidepanel, VAULT_PASSPHRASE);
      await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible();

      expect(await accountSnapshot(sidepanel)).toEqual(seeded);
      await openSettingsSection(sidepanel, "Connected sites");
      await expect(sidepanel.getByText("Sepolia", { exact: true })).toBeVisible();
      await expect(sidepanel.getByText(dappServer.origin, { exact: true })).toBeVisible();
      await sidepanel.getByRole("button", { name: "Back" }).click();
      await expect(
        sidepanel.getByRole("button", { name: "Network Starknet Sepolia" }),
      ).toBeVisible();

      const dapp = await upgraded.context.newPage();
      await dapp.goto(dappServer.url);
      await dapp.getByTestId("preauth").click();
      await expect(dapp.getByTestId("preauth-result")).toHaveText("true");

      await expect
        .poll(() => storedSchemaVersion(upgraded.serviceWorker))
        .toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      await upgraded.close();
    }
  } finally {
    await dappServer.close();
    await rm(root, { force: true, recursive: true });
  }
});
