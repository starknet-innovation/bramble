/**
 * The shared receipt (account deployment, NFT transfer) states only what the
 * chain answered. A rejected or reverted transaction must read as a failure,
 * with the chain's reason and the failure mark, never as the success copy just
 * because an answer arrived; and no mark is drawn before any answer.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ConfirmationOutcome } from "../../../src/sidepanel/shared/confirm-submitted";
import {
  outcomeReceiptActions,
  outcomeReceiptFor,
  outcomeReceiptSection,
  paintOutcomeReceipt,
} from "../../../src/sidepanel/shared/outcome-receipt";
import { registerDom, unregisterDom } from "../../support/groups-harness";

const HASH = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const COPY = {
  confirmedDescription: "This account is on Starknet and can submit transactions.",
  confirmedTitle: "Account deployed",
  failedTitle: "Deployment failed",
  submittedTitle: "Deployment submitted",
};
const SUCCEEDED: ConfirmationOutcome = { kind: "succeeded", toast: "Transaction confirmed" };
const REVERTED: ConfirmationOutcome = {
  kind: "failed",
  message: "Starknet reverted this transaction. Review its activity details before retrying.",
  toast: "Transaction was not confirmed",
};

const mount = (): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = outcomeReceiptSection(
    "deploy-success",
    outcomeReceiptActions("deploy-activity"),
  );
  document.body.append(root);
  return root;
};

const visibleMarks = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<SVGElement>("[data-receipt-mark]")]
    .filter((mark) => !mark.hasAttribute("hidden"))
    .map((mark) => mark.dataset["receiptMark"] ?? "");

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

describe("outcomeReceiptFor", () => {
  test("a confirmed transaction gets the confirmed copy", () => {
    expect(outcomeReceiptFor(SUCCEEDED, COPY, HASH)).toEqual({
      description: COPY.confirmedDescription,
      hash: HASH,
      state: "confirmed",
      title: "Account deployed",
    });
  });

  test("a reverted or rejected transaction is a failure with the chain's reason", () => {
    expect(outcomeReceiptFor(REVERTED, COPY, HASH)).toEqual({
      description: REVERTED.kind === "failed" ? REVERTED.message : "",
      hash: HASH,
      state: "failed",
      title: "Deployment failed",
    });
  });

  test("no answer yet claims only that it was submitted", () => {
    const receipt = outcomeReceiptFor(null, COPY, HASH);
    expect(receipt.state).toBe("submitted");
    expect(receipt.title).toBe("Deployment submitted");
    expect(receipt.description).toContain("Not confirmed yet");
  });
});

describe("paintOutcomeReceipt", () => {
  test("a failure shows the failure mark, as an alert, and no success copy", () => {
    const root = mount();
    paintOutcomeReceipt(root, "deploy-success", outcomeReceiptFor(REVERTED, COPY, HASH), "SN_MAIN");

    const section = root.querySelector<HTMLElement>("#deploy-success");
    expect(root.querySelector("#deploy-success-title")?.textContent).toBe("Deployment failed");
    expect(root.querySelector("#deploy-success-description")?.textContent).toContain("reverted");
    expect(visibleMarks(root)).toEqual(["failed"]);
    expect(section?.classList.contains("send-failure")).toBe(true);
    expect(section?.classList.contains("send-success")).toBe(false);
    expect(section?.getAttribute("role")).toBe("alert");
  });

  test("a confirmation shows the success mark as a status", () => {
    const root = mount();
    paintOutcomeReceipt(
      root,
      "deploy-success",
      outcomeReceiptFor(SUCCEEDED, COPY, HASH),
      "SN_MAIN",
    );

    expect(visibleMarks(root)).toEqual(["confirmed"]);
    expect(root.querySelector("#deploy-success")?.getAttribute("role")).toBe("status");
  });

  test("before any answer no mark is drawn", () => {
    const root = mount();
    paintOutcomeReceipt(root, "deploy-success", outcomeReceiptFor(null, COPY, HASH), "SN_MAIN");

    expect(visibleMarks(root)).toEqual([]);
  });

  test("a later confirmation clears an earlier failure paint", () => {
    const root = mount();
    paintOutcomeReceipt(root, "deploy-success", outcomeReceiptFor(REVERTED, COPY, HASH), "SN_MAIN");
    paintOutcomeReceipt(
      root,
      "deploy-success",
      outcomeReceiptFor(SUCCEEDED, COPY, HASH),
      "SN_MAIN",
    );

    expect(visibleMarks(root)).toEqual(["confirmed"]);
    expect(root.querySelector("#deploy-success")?.classList.contains("send-failure")).toBe(false);
  });
});
