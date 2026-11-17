/**
 * Multisig titles and setup choices wrap instead of truncating at side-panel
 * width (#807). They once carried `text-wrap: nowrap` with an ellipsis, so the
 * panel showed "Create a multisig a…" as the choice and cut the screen title.
 */
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createWalletFromGeneratedPhrase } from "./wallet-helpers";

const truncated = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => element.scrollWidth > element.clientWidth);

test("multisig titles and setup choices are never cut off", async ({ extension }) => {
  const page = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(page);
  // Chrome's narrowest side panel.
  await page.setViewportSize({ height: 800, width: 320 });

  await page.locator("#account-trigger").click();
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByRole("button", { name: /^Multisig account/ }).click();

  const choice = page.locator(".multisig-setup-option strong", {
    hasText: "Create a multisig account",
  });
  await expect(choice).toBeVisible();
  expect(await truncated(choice)).toBe(false);
  for (const supporting of await page
    .locator(".multisig-setup-option .add-account-option-copy > span")
    .all()) {
    expect(await truncated(supporting)).toBe(false);
  }

  await choice.click();
  const title = page.locator(".flow-title h1", { hasText: "Create a multisig account" });
  await expect(title).toBeVisible();
  expect(await truncated(title)).toBe(false);
  // The signer row's name and source-and-key line wrap too.
  const signer = page.locator(".multisig-selected-signer:not([hidden])").first();
  for (const line of [signer.locator(".option-copy strong"), signer.locator(".option-sub")]) {
    await expect(line).toBeVisible();
    expect(await truncated(line)).toBe(false);
  }
});
