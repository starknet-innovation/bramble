/**
 * Core flows that end in a broadcast, run against the scripted chain in
 * `fake-chain.ts`: what the wallet signs and submits, not just what it shows.
 */
import { startFakeChain } from "./fake-chain";
import { expect, test } from "./fixtures";
import { startTestDapp } from "./test-dapp-server";
import {
  createWalletFromGeneratedPhrase,
  resolveConnectionApproval,
  resolvePendingApproval,
} from "./wallet-helpers";

const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const TRANSFER = "0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e";
const RECIPIENT = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

type InvokeParams = {
  readonly invoke_transaction: {
    readonly calldata: readonly string[];
    readonly signature: readonly string[];
  };
};

test("sends STRK from the wallet and records it in Activity", async ({ extension }) => {
  const chain = await startFakeChain(extension.context);
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(sidepanel);

  await sidepanel.getByRole("button", { name: "Send" }).first().click();
  await sidepanel.getByLabel("Recipient address or saved name").fill(`0x0${RECIPIENT.slice(2)}`);
  await sidepanel.getByRole("button", { name: "Continue with address" }).click();
  await sidepanel.getByLabel("Amount to send").fill("1.5");
  await sidepanel.getByRole("button", { name: "Review send" }).click();
  await expect(sidepanel.getByRole("heading", { name: "Review send" })).toBeVisible();
  await sidepanel.getByRole("button", { name: "Confirm and send" }).click();
  await expect(sidepanel.getByText("Send complete")).toBeVisible({ timeout: 15_000 });

  expect(chain.broadcasts.map((tx) => tx.method)).toEqual(["starknet_addInvokeTransaction"]);
  const invoke = chain.broadcasts[0]?.params as InvokeParams;
  // transfer(recipient, u256 1.5e18) on STRK, nothing batched alongside it.
  expect(invoke.invoke_transaction.calldata).toEqual([
    "0x1",
    STRK,
    TRANSFER,
    "0x3",
    RECIPIENT,
    "0x14d1120d7b160000",
    "0x0",
  ]);
  expect(invoke.invoke_transaction.signature.length).toBeGreaterThan(0);

  await sidepanel.getByRole("button", { name: "View in Activity tab" }).click();
  await expect(sidepanel.getByText("Sent 1.5 STRK")).toBeVisible();
  expect([...chain.unhandled]).toEqual([]);
  await chain.stop();
});

test("approves a dapp invoke and broadcasts exactly the reviewed call", async ({ extension }) => {
  const chain = await startFakeChain(extension.context);
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
    await resolvePendingApproval(sidepanel, "Transaction request", dappServer.origin, "approve");

    await expect(dapp.getByTestId("invoke-result")).toContainText('"status":"resolved"');
    expect(chain.broadcasts.map((tx) => tx.method)).toEqual(["starknet_addInvokeTransaction"]);
    const invoke = chain.broadcasts[0]?.params as InvokeParams;
    // The dapp's single transfer(0x5, 1000) to 0x123, as the review showed it.
    expect(invoke.invoke_transaction.calldata).toEqual([
      "0x1",
      "0x123",
      TRANSFER,
      "0x3",
      "0x5",
      "0x3e8",
      "0x0",
    ]);
    expect(invoke.invoke_transaction.signature.length).toBeGreaterThan(0);
    expect([...chain.unhandled]).toEqual([]);
  } finally {
    await dappServer.close();
    await chain.stop();
  }
});
