/**
 * Drives a public self-transfer through the Send review. Confirm is clicked
 * only after the screen shows a STRK fee inside the hard cap.
 */

import { sameFelt } from "@bramble/wallet-model/networks";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { checkDisplayedStrkFee, MAX_TX_FEE_STRK } from "../local-mainnet-limits";

const HASH_IDS = ["send-success-hash", "send-pending-hash", "send-failure-hash"] as const;

const chooseToken = async (page: Page, symbol: "ETH" | "STRK"): Promise<void> => {
  const current = (await page.locator("#send-selected-token-symbol").textContent())?.trim();
  if (current === symbol) {
    return;
  }
  await page.locator("#send-token-trigger").click();
  const option = page.locator(`#send-token-options [data-token-symbol="${symbol}"]`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator("#send-selected-token-symbol")).toHaveText(symbol);
};

const reviewFeeText = async (page: Page): Promise<string> => {
  let latest = "";
  await expect
    .poll(
      async () => {
        latest = (await page.locator("#send-review-fee").textContent()) ?? "";
        if (latest.includes("Estimated fee:")) {
          return "ready";
        }
        const result = ((await page.locator("#transfer-result").textContent()) ?? "").trim();
        if ((await page.locator("#send-details").isVisible()) && result.length > 0) {
          latest = result;
          return "failed";
        }
        if (/unavailable|could not|couldn't|failed/iu.test(latest)) {
          return "failed";
        }
        return "waiting";
      },
      { intervals: [500, 1_000, 2_000], timeout: 90_000 },
    )
    .not.toBe("waiting");
  return latest;
};

const assertFeeAcceptable = (text: string): void => {
  if (text.includes("less than this transaction needs")) {
    throw new Error(
      "The account does not have enough STRK for this self-transfer and its fee. Nothing was submitted.",
    );
  }
  const check = checkDisplayedStrkFee(text);
  if (check.kind === "ok") {
    return;
  }
  const why =
    check.kind === "over"
      ? `the displayed fee is above the ${MAX_TX_FEE_STRK} STRK cap`
      : "the review did not show a STRK fee";
  throw new Error(`Refusing to submit: ${why}. Nothing was submitted.`);
};

const submittedHash = async (page: Page): Promise<string> => {
  let failure = "";
  let hash = "";
  await expect
    .poll(
      async () => {
        if (await page.locator("#send-failure").isVisible()) {
          failure = (await page.locator("#send-failure-copy").textContent()) ?? "The send failed.";
          return "failed";
        }
        for (const id of HASH_IDS) {
          const title = await page.locator(`#${id}`).getAttribute("title");
          if (title?.startsWith("0x")) {
            hash = title;
            return "hash";
          }
        }
        return "waiting";
      },
      { intervals: [1_000, 2_000, 4_000], timeout: 180_000 },
    )
    .not.toBe("waiting");
  if (failure.length > 0) {
    throw new Error(failure.slice(0, 400));
  }
  if (hash.length === 0) {
    throw new Error("The send did not return a transaction hash.");
  }
  return hash;
};

/**
 * Sends `amount` of `symbol` to `recipient` through the review screen.
 * Returns the transaction hash once the wallet has one. Does not click
 * Confirm when the fee is missing, not STRK, or above the cap.
 */
export const selfTransfer = async (
  page: Page,
  input: { readonly amount: string; readonly recipient: string; readonly symbol: "ETH" | "STRK" },
): Promise<string> => {
  await page.locator('.action-tile[data-view="send"]').click();
  await page.locator("#send-recipient-search").fill(input.recipient);
  await expect(page.locator("#send-recipient-continue")).toBeEnabled();
  await page.locator("#send-recipient-continue").click();
  await expect(page.locator("#send-details")).toBeVisible();
  await chooseToken(page, input.symbol);
  await page.locator("#send-amount-input").fill(input.amount);
  await expect(page.locator("#send-review-button")).toBeEnabled();
  await page.locator("#send-review-button").click();
  await expect(page.locator("#send-review-stage")).toBeVisible();
  assertFeeAcceptable(await reviewFeeText(page));
  await expect(page.locator("#send-confirm-button")).toBeEnabled();
  await page.locator("#send-confirm-button").click();
  return submittedHash(page);
};

const activityStatus = async (page: Page, hash: string): Promise<string> => {
  const rows = page.locator("li.tx-row");
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const disclosure = await row.locator("[data-disclosure]").getAttribute("data-disclosure");
    if (disclosure?.startsWith("tx:") && sameFelt(disclosure.slice(3), hash)) {
      return (await row.getAttribute("data-activity-status")) ?? "";
    }
  }
  return "";
};

/**
 * Opens Activity and waits until `hash` is listed as pending, preconfirmed,
 * or accepted. A rejected or reverted row fails the test.
 */
export const expectActivity = async (page: Page, hash: string): Promise<void> => {
  if (await page.locator("#send-view-activity").isVisible()) {
    await page.locator("#send-view-activity").click();
  } else if (await page.locator("#send-pending-activity").isVisible()) {
    await page.locator("#send-pending-activity").click();
  } else {
    await page.locator('[data-view="activity"]').click();
  }
  let status = "";
  await expect
    .poll(
      async () => {
        status = await activityStatus(page, hash);
        return status;
      },
      { intervals: [1_000, 2_000, 4_000], timeout: 60_000 },
    )
    .toMatch(/^(?:pending|preconfirmed|accepted)$/u);
  if (status === "rejected" || status === "reverted") {
    throw new Error(`Activity shows the transaction as ${status}.`);
  }
};

/** A gasless quote rendered on the Send review, still unsubmitted. */
export type GaslessOfferButton = {
  readonly amount: string;
  readonly decimals: number;
  readonly label: string;
  readonly tokenAddress: string;
};

/**
 * Reads the gasless choices on the open Send review. An empty list means the
 * wallet offered none, not that one was submitted.
 */
export const readGaslessOffers = async (page: Page): Promise<readonly GaslessOfferButton[]> => {
  await expect
    .poll(
      async () => {
        const offers = await page.locator("#send-review-fee [data-gasless-token]").count();
        const fee = (await page.locator("#send-review-fee").textContent()) ?? "";
        if (offers > 0 || fee.includes("Estimated fee:")) {
          return "ready";
        }
        return "waiting";
      },
      { intervals: [500, 1_000, 2_000], timeout: 90_000 },
    )
    .toBe("ready");
  const buttons = page.locator("#send-review-fee [data-gasless-token]");
  const count = await buttons.count();
  const offers: GaslessOfferButton[] = [];
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const amount = (await button.getAttribute("data-gasless-amount")) ?? "";
    const decimals = Number((await button.getAttribute("data-gasless-decimals")) ?? "");
    const label = (await button.getAttribute("data-gasless-label")) ?? "";
    const tokenAddress = (await button.getAttribute("data-gasless-token")) ?? "";
    if (amount.length > 0 && label.length > 0 && tokenAddress.length > 0) {
      offers.push({ amount, decimals, label, tokenAddress });
    }
  }
  return offers;
};

/**
 * Clicks the gasless choice for `tokenAddress`. That click submits the send.
 */
export const submitGaslessOffer = async (page: Page, tokenAddress: string): Promise<string> => {
  await page.locator(`#send-review-fee [data-gasless-token="${tokenAddress}"]`).click();
  return submittedHash(page);
};

/**
 * Opens the STRK review used by the gasless spec and stops before Confirm.
 */
export const openStrkReview = async (
  page: Page,
  input: { readonly amount: string; readonly recipient: string },
): Promise<void> => {
  await page.locator('.action-tile[data-view="send"]').click();
  await page.locator("#send-recipient-search").fill(input.recipient);
  await expect(page.locator("#send-recipient-continue")).toBeEnabled();
  await page.locator("#send-recipient-continue").click();
  await expect(page.locator("#send-details")).toBeVisible();
  await chooseToken(page, "STRK");
  await page.locator("#send-amount-input").fill(input.amount);
  await expect(page.locator("#send-review-button")).toBeEnabled();
  await page.locator("#send-review-button").click();
  await expect(page.locator("#send-review-stage")).toBeVisible();
};
