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
  openPendingWalletSurface,
  resolveConnectionApproval,
  resolvePendingApproval,
  VAULT_PASSPHRASE,
} from "./wallet-helpers";

test("keeps wallet setup out of the side panel", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");

  await expect(sidepanel.getByRole("heading", { name: "Set up in a browser tab" })).toBeVisible();
  await expect(sidepanel.getByRole("link", { name: "Open full-screen setup" })).toBeVisible();
  await expect(sidepanel.getByRole("button", { name: "Create a new wallet" })).toHaveCount(0);
});

test("loads the dedicated full-screen onboarding surface", async ({ extension }) => {
  const onboarding = await extension.openExtensionPage("onboarding.html");

  await expect(onboarding.locator("body")).toHaveClass("onboarding-surface");
  await expect(onboarding.getByRole("button", { name: "Create a new wallet" })).toBeVisible();
  await expect(onboarding.getByRole("link", { name: "Open full-screen setup" })).toHaveCount(0);
});

test("completes an imported wallet in full-screen onboarding", async ({ extension }) => {
  const onboarding = await extension.openExtensionPage("onboarding.html");

  await importWalletFromPhrase(onboarding, IMPORT_MNEMONIC);
  await expect(onboarding.getByRole("heading", { name: "You’re all set" })).toBeVisible();
  await expect(onboarding.getByRole("button", { name: "Open MC Wallet" })).toBeVisible();
});

test("loads the built toolbar popup surface", async ({ extension }) => {
  const popup = await extension.openExtensionPage("popup.html");

  await expect(popup.locator("body")).toHaveClass("popup-surface");
  await expect(popup.getByRole("link", { name: "Open full-screen setup" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Create a new wallet" })).toHaveCount(0);
});

test("loads the dedicated Ledger hardware session surface", async ({ extension }) => {
  const ledger = await extension.openExtensionPage(
    "ledger-grant.html#session=2db2df18-12db-4d66-9b38-02dc16460ce3",
  );

  await expect(ledger.getByRole("heading", { name: "Connect your Ledger" })).toBeVisible();
  await expect(ledger.getByText("Secure device session")).toBeVisible();
  await expect(ledger.getByRole("button", { name: /USB cable/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(ledger.getByRole("button", { name: /Bluetooth/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(ledger.getByRole("button", { name: "Connect with USB" })).toBeEnabled();
  await ledger.getByRole("button", { name: /Bluetooth/ }).click();
  await expect(ledger.getByRole("button", { name: "Pair with Bluetooth" })).toBeEnabled();
  await expect(ledger.getByText("Stay on the Ledger dashboard")).toBeVisible();
});

test("imports an existing recovery phrase without backup verification", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC);
});

test("creates a wallet and approves a dapp connection", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  const terminalLink = sidepanel.getByRole("link", { name: "Open trade terminal" });
  await expect(terminalLink).toBeVisible();
  await expect(terminalLink).toHaveAttribute("href", "https://mc-wallet-terminal.vercel.app");
  await expect(terminalLink).toHaveAttribute("target", "_blank");
  await expect(terminalLink).toHaveAttribute("rel", "noopener noreferrer");

  await sidepanel.getByRole("button", { name: "Lock wallet" }).click();
  await expect(sidepanel.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("mc-wallet|MC Wallet|0.1.0");

    await dapp.getByTestId("connect").click();
    await expect(dapp.getByTestId("connect-result")).toHaveText("pending");
    await openPendingWalletSurface(sidepanel);
    await expect(sidepanel.getByText("Site request waiting")).toBeVisible();
    await expect(sidepanel.getByText(dappServer.origin)).toBeVisible();

    await sidepanel.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
    await sidepanel.getByRole("button", { name: "Unlock" }).click();

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

test("signs SNIP-12 typed data through the injected provider approval", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await dapp.getByTestId("connect").click();
    await resolveConnectionApproval(sidepanel, dappServer.origin, "approve");
    await expect(dapp.getByTestId("connect-result")).toContainText('"status":"resolved"');

    await dapp.getByTestId("sign").click();
    await expect(dapp.getByTestId("sign-result")).toHaveText("pending");
    await resolvePendingApproval(sidepanel, "Sign request", dappServer.origin, "approve");

    await expect(dapp.getByTestId("sign-result")).toContainText('"status":"resolved"');
    // The default OpenZeppelin account returns the Stark signature pair directly.
    await expect(dapp.getByTestId("sign-result")).toContainText(
      /"signature":\["0x[0-9a-f]+","0x[0-9a-f]+"\]/,
    );
  } finally {
    await dappServer.close();
  }
});

test("rejects a typed-data signature when the user denies", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await dapp.getByTestId("connect").click();
    await resolveConnectionApproval(sidepanel, dappServer.origin, "approve");
    await expect(dapp.getByTestId("connect-result")).toContainText('"status":"resolved"');

    await dapp.getByTestId("sign").click();
    await expect(dapp.getByTestId("sign-result")).toHaveText("pending");
    await resolvePendingApproval(sidepanel, "Sign request", dappServer.origin, "deny");

    await expect(dapp.getByTestId("sign-result")).toContainText('"status":"rejected"');
  } finally {
    await dappServer.close();
  }
});

test("surfaces an invoke as a transaction approval and rejects on deny", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await dapp.getByTestId("connect").click();
    await resolveConnectionApproval(sidepanel, dappServer.origin, "approve");
    await expect(dapp.getByTestId("connect-result")).toContainText('"status":"resolved"');

    await dapp.getByTestId("invoke").click();
    await expect(dapp.getByTestId("invoke-result")).toHaveText("pending");
    // The provider request surfaces as a transaction approval card in the side
    // panel; denying it rejects the held provider promise.
    await resolvePendingApproval(sidepanel, "Transaction request", dappServer.origin, "deny");

    await expect(dapp.getByTestId("invoke-result")).toContainText('"status":"rejected"');
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
