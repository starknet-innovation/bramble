/**
 * Submits the dust STRK self-transfer through a gasless fee button when the
 * review shows a quote inside the symbol cap. No quote under the cap is not
 * a failure: nothing is submitted and the test is skipped.
 */

import { getTokenBalances } from "@bramble/starknet/rpc";
import { withTokenId } from "@bramble/wallet-model/preferences";
import { expect, test } from "../../e2e/fixtures";
import { requireLocalMainnetAccount } from "../local-mainnet-account";
import { readPublicBalance, waitForSuccessfulReceipt } from "../local-mainnet-chain";
import { gaslessOfferWithinCap, SELF_TRANSFER_AMOUNT } from "../local-mainnet-limits";
import { expectActivity, openStrkReview, readGaslessOffers, submitGaslessOffer } from "./send";
import { openFundedWallet } from "./session";

const account = await requireLocalMainnetAccount();

const tokenBalance = async (
  tokenAddress: string,
  decimals: number,
  label: string,
): Promise<bigint> => {
  const token = withTokenId({
    address: tokenAddress,
    decimals,
    name: label,
    networkId: "SN_MAIN",
    symbol: label,
  });
  const balances = await getTokenBalances({
    accountAddress: account.address,
    rpcUrls: [account.rpcUrl],
    tokens: [token],
  });
  const found = balances[0];
  if (!found) {
    throw new Error(`No ${label} balance was returned`);
  }
  return BigInt(found.balance);
};

test("pays a gasless fee when a quote is under the cap", async ({ extension }, testInfo) => {
  const page = await openFundedWallet(extension, account);
  const strkBefore = await readPublicBalance(account.rpcUrl, account.address, "STRK");
  await openStrkReview(page, { amount: SELF_TRANSFER_AMOUNT, recipient: account.address });
  const offers = await readGaslessOffers(page);
  const chosen = offers.find((offer) => gaslessOfferWithinCap(offer));
  if (!chosen) {
    testInfo.skip(
      true,
      "No gasless quote was under the fee cap, so the gasless send was not submitted.",
    );
    return;
  }
  const feeBefore = await tokenBalance(chosen.tokenAddress, chosen.decimals, chosen.label);
  const quoted = BigInt(chosen.amount);
  const hash = await submitGaslessOffer(page, chosen.tokenAddress);
  await waitForSuccessfulReceipt(account.rpcUrl, hash);
  await expect
    .poll(async () => (await readPublicBalance(account.rpcUrl, account.address, "STRK")).raw, {
      intervals: [2_000, 4_000],
      timeout: 60_000,
    })
    .toBe(strkBefore.raw);
  await expect
    .poll(
      async () => {
        const after = await tokenBalance(chosen.tokenAddress, chosen.decimals, chosen.label);
        const drop = feeBefore - after;
        return drop > 0n && drop <= quoted;
      },
      { intervals: [2_000, 4_000], timeout: 60_000 },
    )
    .toBe(true);
  await expectActivity(page, hash);
});
