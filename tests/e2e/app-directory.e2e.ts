/**
 * The app directory as it ships (mc-wallet issue 749): with no app listed yet,
 * the built extension offers no directory row in Settings, and a connection
 * request from an unlisted site carries no listed-app line. Listed behaviour
 * is covered by the unit suites against fixture directories, because this
 * suite runs the production bundle and no real app is listed by a test.
 */
import { expect, test } from "./fixtures";
import { startTestDapp } from "./test-dapp-server";
import {
  createWalletFromGeneratedPhrase,
  openPendingWalletSurface,
  resolveConnectionApproval,
} from "./wallet-helpers";

test("an empty directory adds no menu row and no listed-app line", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  await sidepanel.locator('nav [data-view="settings"]').first().click();
  await expect(sidepanel.locator("#wallet-screen-settings")).toBeVisible();
  await expect(sidepanel.locator('.menu-row[data-view="connected-sites"]')).toBeVisible();
  await expect(sidepanel.locator('[data-view="apps"]')).toHaveCount(0);

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await dapp.getByTestId("connect").click();
    await expect(dapp.getByTestId("connect-result")).toHaveText("pending");
    await openPendingWalletSurface(sidepanel);
    await expect(sidepanel.getByText("Connection request", { exact: true })).toBeVisible();
    await expect(sidepanel.locator(".request-listed")).toHaveCount(0);
    await resolveConnectionApproval(sidepanel, dappServer.origin, "approve");
    await expect(dapp.getByTestId("connect-result")).toContainText('"status":"resolved"');
  } finally {
    await dappServer.close();
  }
});
