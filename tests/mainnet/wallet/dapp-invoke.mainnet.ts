/**
 * A loopback dapp asks the wallet to execute a self-transfer, then the same
 * transfer twice in one multicall. Both are approved on the transaction card
 * after a capped STRK fee, and both reach a successful receipt.
 */

import { isRecord } from "@bramble/core/json";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/fixtures";
import { resolveConnectionApproval } from "../../e2e/wallet-helpers";
import { requireLocalMainnetAccount } from "../local-mainnet-account";
import { mainnetToken, transferredToSelf, waitForSuccessfulReceipt } from "../local-mainnet-chain";
import { selfTransferRaw } from "../local-mainnet-limits";
import { approvePricedTransaction, resolvedOutput, startWalletDapp } from "./dapp";
import { expectActivity } from "./send";
import { openFundedWallet } from "./session";

const account = await requireLocalMainnetAccount();
const amountRaw = selfTransferRaw(18);
const strk = mainnetToken("STRK");

const transactionHash = (value: unknown): string => {
  if (!isRecord(value) || !isRecord(value["result"])) {
    throw new Error("The dapp did not return a transaction result.");
  }
  const hash = value["result"]["transaction_hash"];
  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error("The dapp did not return a transaction hash.");
  }
  return hash;
};

const connect = async (
  extension: { readonly context: { readonly newPage: () => Promise<Page> } },
  sidepanel: Page,
  origin: string,
  url: string,
): Promise<Page> => {
  const dapp = await extension.context.newPage();
  await dapp.goto(url);
  await expect(dapp.locator('[data-testid="provider-status"]')).not.toHaveText("missing");
  await dapp.locator('[data-testid="connect"]').click();
  await resolveConnectionApproval(sidepanel, origin, "approve");
  const connected = await resolvedOutput(dapp, "connect-result");
  if (!isRecord(connected) || !Array.isArray(connected["result"])) {
    throw new Error("The dapp did not receive the connected account.");
  }
  const addresses = connected["result"].filter((item): item is string => typeof item === "string");
  expect(addresses.some((item) => sameFelt(item, account.address))).toBe(true);
  return dapp;
};

test("executes a dapp invoke self-transfer", async ({ extension }) => {
  const sidepanel = await openFundedWallet(extension, account);
  const server = await startWalletDapp(strk.address, account.address, amountRaw);
  try {
    const dapp = await connect(extension, sidepanel, server.origin, server.url);
    await dapp.locator('[data-testid="invoke"]').click();
    await approvePricedTransaction(sidepanel, server.origin);
    const hash = transactionHash(await resolvedOutput(dapp, "invoke-result"));
    const receipt = await waitForSuccessfulReceipt(account.rpcUrl, hash);
    expect(transferredToSelf(receipt, strk.address, account.address)).toBe(amountRaw);
    await expectActivity(sidepanel, hash);
  } finally {
    await server.close();
  }
});

test("executes a dapp multicall of two self-transfers", async ({ extension }) => {
  const sidepanel = await openFundedWallet(extension, account);
  const server = await startWalletDapp(strk.address, account.address, amountRaw);
  try {
    const dapp = await connect(extension, sidepanel, server.origin, server.url);
    await dapp.locator('[data-testid="multicall"]').click();
    await approvePricedTransaction(sidepanel, server.origin);
    const hash = transactionHash(await resolvedOutput(dapp, "multicall-result"));
    const receipt = await waitForSuccessfulReceipt(account.rpcUrl, hash);
    expect(transferredToSelf(receipt, strk.address, account.address)).toBe(amountRaw * 2n);
    await expectActivity(sidepanel, hash);
  } finally {
    await server.close();
  }
});
