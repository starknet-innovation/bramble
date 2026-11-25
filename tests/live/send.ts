/**
 * Drives a public transfer through the Send review on any network. Confirm is
 * clicked only after the screen shows a STRK fee inside the caller's cap.
 */

import { parseTokenAmount } from "@bramble/starknet/rpc";
import {
  STARKNET_NETWORKS,
  STRK_TOKEN_DECIMALS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { MAX_TX_FEE_STRK } from "../mainnet/local-mainnet-limits";
import { checkDisplayedStrkFee } from "./fee-cap";

const HASH_IDS = ["send-success-hash", "send-pending-hash", "send-failure-hash"] as const;
// Each step waits on the wallet (a fee estimate, a balance read) over a live
// node. Explicit, because callers outside the Playwright runner (the Sepolia
// send run) get expect's 5 s default instead of a config's 30 s.
const STEP = { timeout: 30_000 } as const;

const chooseToken = async (page: Page, symbol: "ETH" | "STRK"): Promise<void> => {
  const current = (await page.locator("#send-selected-token-symbol").textContent())?.trim();
  if (current === symbol) {
    return;
  }
  await page.locator("#send-token-trigger").click();
  const option = page.locator(`#send-token-options [data-token-symbol="${symbol}"]`);
  await expect(option).toBeVisible(STEP);
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

const assertFeeAcceptable = (text: string, maxFeeStrk: string): void => {
  if (text.includes("less than this transaction needs")) {
    throw new Error(
      "The account does not have enough STRK for this self-transfer and its fee. Nothing was submitted.",
    );
  }
  const check = checkDisplayedStrkFee(text, maxFeeStrk);
  if (check.kind === "ok") {
    return;
  }
  const why =
    check.kind === "over"
      ? `the displayed fee is above the ${maxFeeStrk} STRK cap`
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

/** What a send is meant to do; the review must show exactly this before Confirm. */
export type SendIntent = {
  readonly amount: string;
  readonly networkId: StarknetNetworkId;
  readonly recipient: string;
  readonly sender: string;
  readonly symbol: "ETH" | "STRK";
};

const reviewFact = (page: Page, term: string): Locator =>
  page
    .locator("#send-review-summary .send-review-facts > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${term}$`, "u") }) })
    .locator("dd");

const fullAddress = async (fact: Locator): Promise<string> =>
  (await fact.locator("code").first().getAttribute("title")) ?? "";

/**
 * Checks the review's From, To, Network and Amount against `intent` and throws
 * on any difference, so nothing is confirmed unless the screen shows what is
 * being signed. Addresses compare by the full address the review carries, not
 * the truncated label.
 */
const expectReviewShows = async (page: Page, intent: SendIntent): Promise<void> => {
  await expect(page.locator("#send-review-summary .send-review-facts")).toBeVisible(STEP);
  const from = await fullAddress(reviewFact(page, "From"));
  const to = await fullAddress(reviewFact(page, "To"));
  const network = ((await reviewFact(page, "Network").textContent()) ?? "").trim();
  const amount = ((await reviewFact(page, "Amount").locator("strong").textContent()) ?? "").trim();
  const wrong = [
    sameFelt(from, intent.sender) ? "" : `From ${from || "(missing)"}`,
    sameFelt(to, intent.recipient) ? "" : `To ${to || "(missing)"}`,
    network === STARKNET_NETWORKS[intent.networkId].name ? "" : `Network "${network}"`,
    amount === `${intent.amount} ${intent.symbol}` ? "" : `Amount "${amount}"`,
  ].filter(Boolean);
  if (wrong.length > 0) {
    throw new Error(
      `Refusing to submit: the review shows ${wrong.join(", ")}, not what was entered. Nothing was submitted.`,
    );
  }
};

/**
 * Fills the Send form from `intent` and opens its review, then checks the
 * review shows exactly that intent. Stops before Confirm.
 */
export const openReview = async (page: Page, intent: SendIntent): Promise<void> => {
  await page.locator('.action-tile[data-view="send"]').click();
  await page.locator("#send-recipient-search").fill(intent.recipient);
  await expect(page.locator("#send-recipient-continue")).toBeEnabled(STEP);
  await page.locator("#send-recipient-continue").click();
  await expect(page.locator("#send-details")).toBeVisible(STEP);
  await chooseToken(page, intent.symbol);
  await page.locator("#send-amount-input").fill(intent.amount);
  await expect(page.locator("#send-review-button")).toBeEnabled(STEP);
  await page.locator("#send-review-button").click();
  await expect(page.locator("#send-review-stage")).toBeVisible(STEP);
  await expectReviewShows(page, intent);
};

/**
 * Sends `intent` through the review screen and returns the transaction hash
 * once the wallet has one. Does not click Confirm when the review shows
 * anything other than `intent`, or a fee that is missing, not STRK, or above
 * `maxFeeStrk`. On mainnet the cap can never exceed MAX_TX_FEE_STRK,
 * whatever a caller passes.
 */
export const selfTransfer = async (
  page: Page,
  input: SendIntent & { readonly maxFeeStrk: string },
): Promise<string> => {
  if (
    input.networkId === "SN_MAIN" &&
    parseTokenAmount(input.maxFeeStrk, STRK_TOKEN_DECIMALS) >
      parseTokenAmount(MAX_TX_FEE_STRK, STRK_TOKEN_DECIMALS)
  ) {
    throw new Error(
      `A mainnet fee cap above ${MAX_TX_FEE_STRK} STRK is refused. Nothing was submitted.`,
    );
  }
  await openReview(page, input);
  assertFeeAcceptable(await reviewFeeText(page), input.maxFeeStrk);
  await expect(page.locator("#send-confirm-button")).toBeEnabled(STEP);
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
