/**
 * Self-transfers a dust amount of STRK, and of ETH when the account holds
 * some. The principal returns to the same account. The STRK balance drops by
 * the receipt fee, which the review had to show before Confirm.
 */
import { expect, test } from "../../e2e/fixtures";
import { requireLocalMainnetAccount } from "../local-mainnet-account";
import {
  mainnetToken,
  readPublicBalance,
  receiptStrkFee,
  transferredToSelf,
  waitForSuccessfulReceipt,
} from "../local-mainnet-chain";
import { SELF_TRANSFER_AMOUNT, selfTransferRaw } from "../local-mainnet-limits";
import { expectActivity, selfTransfer } from "./send";
import { expectDisplayedBalance, openFundedWallet } from "./session";

const account = await requireLocalMainnetAccount();
const amountRaw = selfTransferRaw(18);

const expectDrop = async (
  read: () => Promise<bigint>,
  before: bigint,
  drop: bigint,
): Promise<void> => {
  await expect
    .poll(async () => before - (await read()), {
      intervals: [2_000, 4_000],
      timeout: 60_000,
    })
    .toBe(drop);
};

test("self-transfers dust STRK and shows it in Activity", async ({ extension }) => {
  const page = await openFundedWallet(extension, account);
  const before = await readPublicBalance(account.rpcUrl, account.address, "STRK");
  const hash = await selfTransfer(page, {
    amount: SELF_TRANSFER_AMOUNT,
    recipient: account.address,
    symbol: "STRK",
  });
  const receipt = await waitForSuccessfulReceipt(account.rpcUrl, hash);
  const fee = receiptStrkFee(receipt);
  expect(transferredToSelf(receipt, mainnetToken("STRK").address, account.address)).toBe(amountRaw);
  await expectDrop(
    async () => (await readPublicBalance(account.rpcUrl, account.address, "STRK")).raw,
    before.raw,
    fee,
  );
  await expectActivity(page, hash);
  const after = await readPublicBalance(account.rpcUrl, account.address, "STRK");
  await page.reload();
  await expect(page.locator("#account-trigger")).toBeVisible();
  await page.locator('[data-view="home"]').click();
  await expectDisplayedBalance(page, mainnetToken("STRK"), after.formatted);
});

test("self-transfers dust ETH when the account holds ETH", async ({ extension }, testInfo) => {
  const before = await readPublicBalance(account.rpcUrl, account.address, "ETH");
  if (before.raw < amountRaw) {
    testInfo.skip(true, "Account holds no ETH; the ETH self-transfer was not submitted.");
    return;
  }
  const page = await openFundedWallet(extension, account);
  const strkBefore = await readPublicBalance(account.rpcUrl, account.address, "STRK");
  const hash = await selfTransfer(page, {
    amount: SELF_TRANSFER_AMOUNT,
    recipient: account.address,
    symbol: "ETH",
  });
  const receipt = await waitForSuccessfulReceipt(account.rpcUrl, hash);
  const fee = receiptStrkFee(receipt);
  expect(transferredToSelf(receipt, mainnetToken("ETH").address, account.address)).toBe(amountRaw);
  await expectDrop(
    async () => (await readPublicBalance(account.rpcUrl, account.address, "ETH")).raw,
    before.raw,
    0n,
  );
  await expectDrop(
    async () => (await readPublicBalance(account.rpcUrl, account.address, "STRK")).raw,
    strkBefore.raw,
    fee,
  );
  await expectActivity(page, hash);
});
