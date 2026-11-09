/**
 * Imports the sncast account and checks the home STRK and ETH rows against
 * the public balances read from the dedicated RPC. This spec does not send.
 */
import { expect, test } from "../../e2e/fixtures";
import { requireLocalMainnetAccount } from "../local-mainnet-account";
import { mainnetToken, readPublicBalance } from "../local-mainnet-chain";
import { expectDisplayedBalance, openFundedWallet } from "./session";

const account = await requireLocalMainnetAccount();

test("shows STRK and ETH balances that match the chain", async ({ extension }) => {
  const page = await openFundedWallet(extension, account);
  for (const symbol of ["STRK", "ETH"] as const) {
    const chain = await readPublicBalance(account.rpcUrl, account.address, symbol);
    await expectDisplayedBalance(page, mainnetToken(symbol), chain.formatted);
    expect(chain.formatted.length).toBeGreaterThan(0);
  }
});
