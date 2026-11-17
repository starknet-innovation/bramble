/**
 * Home fills in rather than flashes an error (issue 795). With no saved
 * balance snapshot and the chain still answering, Home shows its loading
 * shell: no failed-load panel and no "Balances are temporarily unavailable."
 * in the header. Once the read genuinely fails, the failure is shown.
 */
import type { Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createWalletFromGeneratedPhrase } from "./wallet-helpers";

const UNAVAILABLE = "Balances are temporarily unavailable.";

test("a first open loads quietly, and a failed read still says so", async ({ extension }) => {
  const page = await extension.openExtensionPage("sidepanel.html");
  // Hold every chain request open: the balance read is still in flight, which
  // is the window in which Home used to show its failed-load panel.
  const held: Route[] = [];
  let failNow = false;
  await page.context().route("https://*.starknet.org/**", async (route) => {
    if (failNow) await route.abort();
    else held.push(route);
  });

  await createWalletFromGeneratedPhrase(page);
  const home = page.locator("#wallet-screen-home");
  await expect(home).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);

  await expect(home.locator(".panel-error")).toHaveCount(0);
  await expect(page.locator(".account-net")).not.toHaveAttribute("title", UNAVAILABLE);
  await expect(home.locator(".hero-total")).toHaveText("—");
  await expect(home.locator(".token-list[aria-busy='true']")).toHaveCount(1);

  failNow = true;
  for (const route of held.splice(0)) await route.abort();

  await expect(home.locator(".panel-error")).toHaveCount(1, { timeout: 20_000 });
  await expect(home.getByRole("button", { name: "Retry loading balances" })).toBeVisible();
  await expect(home.locator(".token-list[aria-busy='true']")).toHaveCount(0);
});
