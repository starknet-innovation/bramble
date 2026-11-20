/**
 * A queued dapp invoke carries each English review line together with its
 * review-sentence reference, so the panel can render it in the reader's
 * language; the reference always re-renders to exactly that English.
 */
import { expect, test } from "bun:test";
import type { MessageRef } from "@bramble/core/i18n";
import { isReviewText, reviewEnglish } from "@bramble/transactions/review-messages";
import { latestApprovalId, waitForPendingApprovals } from "../../support/held";
import {
  invokeContentSender as contentSender,
  invokeExtensionSender as extensionSender,
  invokeMessage,
  makeInvokeHarness as makeHarness,
} from "../../support/invoke-approval-harness";

type Pending = {
  readonly id: string;
  readonly flags?: readonly { message: string; text?: MessageRef }[];
  readonly summaries?: readonly string[];
  readonly summaryTexts?: readonly MessageRef[];
};

test("every summary and flag of a queued invoke has a matching reference", async () => {
  const { handler } = makeHarness();
  const held = handler(invokeMessage(), contentSender);
  const pending = (await waitForPendingApprovals<Pending>(handler, extensionSender)).at(-1);

  const summaries = pending?.summaries ?? [];
  expect(summaries.length).toBeGreaterThan(0);
  expect(pending?.summaryTexts?.length).toBe(summaries.length);
  pending?.summaryTexts?.forEach((text, index) => {
    expect(isReviewText(text)).toBe(true);
    expect(reviewEnglish(text)).toBe(summaries[index] ?? "");
  });
  for (const flag of pending?.flags ?? []) {
    expect(flag.text === undefined || reviewEnglish(flag.text) === flag.message).toBe(true);
  }

  const id = await latestApprovalId(handler, extensionSender);
  await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
  await expect(held).resolves.toEqual({ error: "request rejected" });
});
