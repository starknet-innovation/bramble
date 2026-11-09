/**
 * The compact wallet surface hands setup to the dedicated tab and gets out of
 * the way: once its link has opened the setup tab it closes itself, so the
 * side panel never sits beside setup showing a stale first-run handoff. The
 * return trip (completion opening the panel and closing the tab) is covered
 * with the import flow in extension.e2e.ts.
 */
import { expect, test } from "./fixtures";

test("the compact surface closes once it has opened full-screen setup", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  const setupTab = extension.context.waitForEvent("page", {
    predicate: (page) => page.url().endsWith("/onboarding.html"),
    timeout: 10_000,
  });

  await sidepanel.getByRole("link", { name: "Open full-screen setup" }).click();

  const onboarding = await setupTab;
  await expect(onboarding.getByRole("button", { name: "Create a new wallet" })).toBeVisible();
  await expect.poll(() => sidepanel.isClosed(), { timeout: 5_000 }).toBe(true);
});
