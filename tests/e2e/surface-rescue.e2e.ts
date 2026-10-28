/**
 * #707: Chrome refuses `sidePanel.open` when a dapp's request arrives after
 * the page's gesture expired. This Playwright Chromium doesn't enforce that
 * expiry, so the refusal is reproduced in the worker; everything after it is
 * the real browser: the background opens the toolbar popup in the dapp's
 * window, restores the side panel toolbar, and the dapp keeps awaiting.
 */
import { expect, test } from "./fixtures";
import { startTestDapp } from "./test-dapp-server";
import { createWalletFromGeneratedPhrase } from "./wallet-helpers";

type Chrome = {
  readonly action: { readonly getPopup: (details: object) => Promise<string> };
  readonly runtime: {
    readonly getContexts: (filter: object) => Promise<readonly { readonly documentUrl?: string }[]>;
  };
  sidePanel: { open: (options: object) => Promise<void> };
};

test("a refused side panel open opens the popup instead", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);
  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("bramble|Bramble|0.1.0");
    await extension.serviceWorker.evaluate(() => {
      const chrome = (globalThis as unknown as { chrome: Chrome }).chrome;
      chrome.sidePanel.open = () =>
        Promise.reject(
          new Error("`sidePanel.open()` may only be called in response to a user gesture."),
        );
    });
    await dapp.getByTestId("connect").click();
    await expect(dapp.getByTestId("connect-result")).toHaveText("pending");
    const popups = () =>
      extension.serviceWorker.evaluate(async () => {
        const chrome = (globalThis as unknown as { chrome: Chrome }).chrome;
        const contexts = await chrome.runtime.getContexts({ contextTypes: ["POPUP"] });
        return contexts.map((context) => context.documentUrl ?? "");
      });
    await expect.poll(popups).toContainEqual(expect.stringMatching(/\/popup\.html$/));
    // The side panel toolbar is back: no popup stays set.
    expect(
      await extension.serviceWorker.evaluate(() =>
        (globalThis as unknown as { chrome: Chrome }).chrome.action.getPopup({}),
      ),
    ).toBe("");
    await expect(dapp.getByTestId("connect-result")).toHaveText("pending");
  } finally {
    await dappServer.close();
  }
});
