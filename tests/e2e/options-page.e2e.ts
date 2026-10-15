/**
 * "Extension options" is the way into the wallet that never depends on the side
 * panel. Arc accepts `sidePanel.open` and draws nothing (#690), so a user there
 * reaches the wallet from the extension's details page instead, in a tab, and
 * can switch the request surface to the popup from Settings.
 */
import { expect, test } from "./fixtures";

test("the options page opens the wallet in a tab", async ({ extension }) => {
  const opener = await extension.openExtensionPage("onboarding.html");
  const optionsTab = extension.context.waitForEvent("page", {
    predicate: (page) =>
      page.url() === `chrome-extension://${extension.extensionId}/sidepanel.html`,
    timeout: 10_000,
  });

  await opener.evaluate(async () => {
    const extensionGlobal = globalThis as typeof globalThis & {
      readonly chrome: { readonly runtime: { readonly openOptionsPage: () => Promise<void> } };
    };
    await extensionGlobal.chrome.runtime.openOptionsPage();
  });

  const wallet = await optionsTab;
  await expect(wallet.getByRole("link", { name: "Open full-screen setup" })).toBeVisible();
});
