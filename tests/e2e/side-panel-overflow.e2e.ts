/**
 * A side panel whose content fits must not scroll. macOS draws overlay
 * scrollbars only while scrolling, so a few stray pixels of document height
 * stay invisible there; Windows draws a classic scrollbar for them on every
 * view (mc-wallet 759). Two such overflows shipped: the scope announcer's 1px
 * box sat below the full-height app, and the first-run gate added the shell's
 * padding to a 100vh min-height.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createWalletFromGeneratedPhrase } from "./wallet-helpers";

const overflow = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement;
    return root.scrollHeight - root.clientHeight;
  });

test("the side panel does not scroll when its content fits", async ({ extension }) => {
  const page = await extension.openExtensionPage("sidepanel.html");
  await page.setViewportSize({ height: 700, width: 360 });
  await expect(page.getByRole("heading", { name: "Set up in a browser tab" })).toBeVisible();
  expect(await overflow(page)).toBe(0);

  await createWalletFromGeneratedPhrase(page);
  await expect(page.getByRole("button", { name: "Lock wallet" })).toBeVisible();
  // Tall enough that every dock view's content fits, so any overflow left is layout.
  await page.setViewportSize({ height: 1400, width: 360 });
  for (const view of ["home", "activity", "settings"]) {
    await page.locator(`nav [data-view="${view}"]`).first().click();
    await expect(page.locator(`#wallet-screen-${view}`)).toBeVisible();
    await expect.poll(() => overflow(page), { message: view }).toBe(0);
  }
});

test("a screen sits centred whatever scrollbar the platform draws", async ({ extension }) => {
  // A classic (Windows) scrollbar used to reserve its gutter on the right only,
  // so the unlock field and button sat off centre (#795).
  const page = await extension.openExtensionPage("sidepanel.html");
  await page.setViewportSize({ height: 700, width: 360 });
  await createWalletFromGeneratedPhrase(page);
  await page.getByRole("button", { name: "Lock wallet" }).click();
  const field = page.getByLabel("Password");
  await expect(field).toBeVisible();
  const inset = await field.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: window.innerWidth - box.right };
  });
  expect(Math.abs(inset.left - inset.right)).toBeLessThanOrEqual(1);
});
