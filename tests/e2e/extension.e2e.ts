/**
 * End-to-end coverage for the built browser extension: load the MV3 package,
 * render the side panel, create a wallet, and approve a dapp connection through
 * the injected provider.
 */
import { expect, test } from "./fixtures";
import { startTestDapp } from "./test-dapp-server";
import {
  createWalletFromGeneratedPhrase,
  IMPORT_MNEMONIC,
  importWalletFromPhrase,
  resolveConnectionApproval,
  unlockWallet,
} from "./wallet-helpers";

test("loads the built extension and renders side panel onboarding", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");

  await expect(sidepanel.getByRole("heading", { name: "Create your wallet" })).toBeVisible();
  await expect(sidepanel.getByRole("button", { name: /Generate phrase/ })).toBeEnabled();
  await expect(sidepanel.locator('select[name="networkId"]')).toHaveValue("SN_MAIN");
});

test("imports an existing recovery phrase without backup verification", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC);
});

test("creates a wallet and approves a dapp connection", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  await sidepanel.getByRole("button", { name: "Lock wallet" }).click();
  await unlockWallet(sidepanel);

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("mc-wallet|MC Wallet|0.1.0");

    await dapp.getByTestId("connect").click();
    await expect(dapp.getByTestId("connect-result")).toHaveText("pending");

    await resolveConnectionApproval(sidepanel, dappServer.origin, "approve");

    await expect(dapp.getByTestId("connect-result")).toContainText('"status":"resolved"');
    await expect(dapp.getByTestId("connect-result")).toContainText("0x");
    await dapp.getByTestId("preauth").click();
    await expect(dapp.getByTestId("preauth-result")).toHaveText("true");
  } finally {
    await dappServer.close();
  }
});

test("denies a dapp connection request", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await dapp.getByTestId("connect").click();
    await expect(dapp.getByTestId("connect-result")).toHaveText("pending");

    await resolveConnectionApproval(sidepanel, dappServer.origin, "deny");

    await expect(dapp.getByTestId("connect-result")).toContainText('"status":"rejected"');
    await dapp.getByTestId("preauth").click();
    await expect(dapp.getByTestId("preauth-result")).toHaveText("false");
  } finally {
    await dappServer.close();
  }
});

test("detects the injected provider after a page reload", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("mc-wallet|MC Wallet|0.1.0");

    await dapp.reload();
    await dapp.getByTestId("detect").click();
    await expect(dapp.getByTestId("provider-status")).toHaveText("mc-wallet|MC Wallet|0.1.0");
  } finally {
    await dappServer.close();
  }
});
