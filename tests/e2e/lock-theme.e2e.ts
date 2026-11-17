/**
 * The lock screen follows the chosen theme. Preferences are display settings,
 * not vault material, so the panel reads them while locked; before this the
 * lock screen always fell back to the dark skin.
 */
import { expect, test } from "./fixtures";
import { createWalletFromGeneratedPhrase, sendRuntimeMessage } from "./wallet-helpers";

test("the lock screen renders in the chosen theme", async ({ extension }) => {
  const page = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(page);
  await expect(page.getByRole("button", { name: "Lock wallet" })).toBeVisible();

  await sendRuntimeMessage(page, { theme: "light", type: "wallet.setDisplay" });
  await sendRuntimeMessage(page, { type: "wallet.lock" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe("light");
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bramble-bg").trim(),
    ),
  ).toBe("#f8f9fb");
});
