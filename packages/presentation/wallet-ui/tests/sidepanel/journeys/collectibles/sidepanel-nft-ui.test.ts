/**
 * NFT detail send coverage through the real DOM binding: the first submit is a
 * read-only review, the second matching submit broadcasts, editing invalidates
 * the review, a poisoning flag never unlocks confirmation, and the receipt
 * reports the chain's answer — complete, or the failure it was.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { sameFelt } from "@bramble/wallet-model/networks";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mount,
  OTHER_RECIPIENT,
  POISONED,
  RECIPIENT,
  recipientInput,
  submit,
  submitButtonOf,
} from "../../../support/nft-send-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

beforeEach(() => {
  document.body.replaceChildren();
});

describe("NFT send review", () => {
  test("reviews first and only broadcasts after the second matching submit", async () => {
    const { app, calls } = mount();
    recipientInput(app).value = RECIPIENT;

    submit(app);
    await flush();
    expect(calls.review).toHaveLength(1);
    expect(calls.transfer).toHaveLength(0);
    expect(app.querySelector("#nft-review-panel")?.textContent).toContain("Send NFT #5");
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Confirm transfer",
    );

    submit(app);
    await flush();
    expect(calls.transfer).toHaveLength(1);
    // Submitted is not delivered: the receipt opens on what the hash proves and
    // firms up only once the chain reports the transfer.
    expect(app.querySelector("#nft-success-title")?.textContent).toBe("Transfer submitted");
    expect(app.querySelector("#nft-success-description")?.textContent).toContain(
      "Not confirmed yet",
    );
    // Nothing to send again while the chain has not answered, so the control
    // leaves the receipt rather than sitting under it disabled.
    expect(submitButtonOf(app).hidden).toBe(true);
    expect(submitButtonOf(app).disabled).toBe(true);
  });

  test("echoes separate undeployed-account fee ceilings into NFT submission", async () => {
    const { app, calls } = mount({
      deploymentFee: { overallFee: "2000", unit: "FRI" },
      deploymentFeeEstimateFailed: false,
      fee: { overallFee: "1000", unit: "FRI" },
      feeAffordability: "ok",
      feeEstimateFailed: false,
      flags: [],
      requiresDeployment: true,
      summaries: ["Deploy + send NFT #5"],
    });
    recipientInput(app).value = RECIPIENT;

    submit(app);
    await flush();
    expect(app.querySelector("#nft-review-panel")?.textContent).toContain(
      "Creating this account on Starknet is",
    );
    submit(app);
    await flush();

    expect(calls.transfer[0]?.slice(-2)).toEqual([
      { overallFee: "1000", unit: "FRI" },
      { overallFee: "2000", unit: "FRI" },
    ]);
  });

  test("editing the recipient invalidates the completed review", async () => {
    const { app, calls } = mount();
    const input = recipientInput(app);
    input.value = RECIPIENT;
    submit(app);
    await flush();

    input.value = "0x123";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    submit(app);
    await flush();
    expect(calls.review).toHaveLength(2);
    expect(calls.transfer).toHaveLength(0);
  });

  test("shows a poisoning warning but never enables confirmation", async () => {
    const { app, calls } = mount({
      fee: { overallFee: "1000", unit: "FRI" },
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      flags: [
        {
          code: "address-poisoning",
          message: "The recipient closely mimics one of your saved addresses.",
        },
      ],
      requiresDeployment: false,
      summaries: ["Send NFT #5"],
    });
    recipientInput(app).value = POISONED;

    submit(app);
    await flush();
    expect(app.querySelector("#nft-send-result")?.textContent).toContain("blocked");
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Review transfer",
    );

    submit(app);
    await flush();
    expect(calls.review).toHaveLength(2);
    expect(calls.transfer).toHaveLength(0);
  });

  test("keeps malformed recipients and failed reviews away from signing", async () => {
    const invalid = mount();
    recipientInput(invalid.app).value = "not-an-address";
    submit(invalid.app);
    await flush();
    expect(invalid.calls.review).toHaveLength(0);
    expect(invalid.calls.transfer).toHaveLength(0);
    expect(invalid.app.querySelector("#nft-send-result")?.textContent).toBe(
      "Enter a valid Starknet address.",
    );

    document.body.replaceChildren();
    const failed = mount(undefined, {
      review: new Error("invalid nft transfer review request"),
    });
    recipientInput(failed.app).value = RECIPIENT;
    submit(failed.app);
    await flush();
    expect(failed.calls.review).toHaveLength(1);
    expect(failed.calls.transfer).toHaveLength(0);
    expect(failed.app.querySelector("#nft-send-result")?.textContent).toBe(
      "Enter a valid Starknet address.",
    );
  });

  test("requires a successful fee retry before confirmation", async () => {
    const review = {
      fee: null,
      feeAffordability: "unknown",
      feeEstimateFailed: true,
      flags: [],
      requiresDeployment: false,
      summaries: ["Send NFT #5"],
    } as const;
    const { app, calls } = mount(review);
    recipientInput(app).value = RECIPIENT;

    submit(app);
    await flush();
    expect(calls.review).toHaveLength(1);
    expect(calls.transfer).toHaveLength(0);
    expect(app.querySelector<HTMLButtonElement>("#review-retry-fee")).not.toBeNull();

    app.querySelector<HTMLButtonElement>("#review-retry-fee")?.click();
    await flush();
    expect(calls.review).toHaveLength(2);
    expect(calls.transfer).toHaveLength(0);
  });

  test("reports a refusal before signing and leaves the reviewed transfer retryable", async () => {
    const { app, calls } = mount(undefined, {
      transfer: new Error("disconnected-mid-sign"),
    });
    recipientInput(app).value = RECIPIENT;

    submit(app);
    await flush();
    submit(app);
    await flush();

    expect(calls.review).toHaveLength(1);
    expect(calls.transfer).toHaveLength(1);
    // The device catalog's own sentence, once.
    expect(app.querySelector("#nft-send-result")?.textContent).toBe(
      "Your Ledger disconnected. Nothing was submitted.",
    );

    submit(app);
    await flush();
    expect(calls.transfer).toHaveLength(2);
  });
});

// Which of the receipt's two sets of actions shows.
const actionsShown = (app: Element, tone: "failed" | "succeeded"): boolean =>
  app.querySelector(`[data-outcome-actions="${tone}"]`)?.hasAttribute("hidden") === false;

const toastTexts = (tone: "error" | "success"): string[] =>
  Array.from(document.querySelectorAll(`.toast.${tone} .toast-text`)).map(
    (node) => node.textContent ?? "",
  );

// Reviews, confirms, and lets the confirmation wait reach the chain's answer.
const transferTo = async (chainStatus: ActivityEntry["status"]) => {
  const mounted = mount(undefined, {}, chainStatus);
  recipientInput(mounted.app).value = RECIPIENT;
  submit(mounted.app);
  await flush();
  submit(mounted.app);
  await flush();
  await flush();
  await flush();
  expect(mounted.calls.transfer).toHaveLength(1);
  return mounted;
};

describe("NFT transfer receipt", () => {
  test("a pre-confirmed transfer reads as complete", async () => {
    const { app } = await transferTo("preconfirmed");
    const receipt = app.querySelector("#nft-success");

    expect(app.querySelector("#nft-success-title")?.textContent).toBe("Transfer complete");
    expect(app.querySelector("#nft-success-description")?.textContent).toBe(
      "The collectible is now held by the recipient.",
    );
    expect(receipt?.classList.contains("send-success")).toBe(true);
    expect(receipt?.querySelector('[data-outcome-mark="succeeded"]')?.hasAttribute("hidden")).toBe(
      false,
    );
    // The toast is the chain's answer; the handoff is the receipt heading's job.
    expect(toastTexts("success")).toEqual(["Transaction pre-confirmed on Starknet"]);
    // The collectible has moved, so there is nothing here to send again.
    expect(submitButtonOf(app).hidden).toBe(true);
    expect(submitButtonOf(app).disabled).toBe(true);
    expect(actionsShown(app, "succeeded")).toBe(true);
    expect(actionsShown(app, "failed")).toBe(false);
  });

  // The receipt is rendered after the shell binds its `data-view` controls,
  // so its ways off are the binding's to wire, or they do nothing.
  test("the receipt's Activity and Back both leave the transfer", async () => {
    const { app, navigations } = await transferTo("preconfirmed");
    const [activity, back] = Array.from(
      app.querySelectorAll<HTMLButtonElement>('[data-outcome-actions="succeeded"] button'),
    );
    expect(back?.textContent).toBe("Back");

    activity?.click();
    back?.click();
    expect(navigations).toEqual(["activity", "home"]);
  });

  // The chain's two refusals. Each turns the receipt into a failure in place —
  // heading, the chain's reason, mark, tone and toast — and never leaves
  // "Transfer complete" over a collectible that did not move.
  for (const [chainStatus, reason] of [
    ["rejected", "Starknet rejected this transaction. Nothing changed."],
    [
      "reverted",
      "Starknet reverted this transaction. Review its activity details before retrying.",
    ],
  ] as const) {
    test(`a ${chainStatus} transfer reads as failed, not complete`, async () => {
      const { app } = await transferTo(chainStatus);
      const receipt = app.querySelector("#nft-success");

      expect(app.querySelector("#nft-success-title")?.textContent).toBe("Transfer failed");
      expect(app.querySelector("#nft-success-description")?.textContent).toBe(reason);
      // The hash stays: it is how the reader finds out why.
      expect(app.querySelector("#nft-success-hash")?.textContent).not.toBe("");
      expect(receipt?.classList.contains("send-failure")).toBe(true);
      expect(receipt?.classList.contains("send-success")).toBe(false);
      expect(receipt?.querySelector('[data-outcome-mark="failed"]')?.hasAttribute("hidden")).toBe(
        false,
      );
      expect(
        receipt?.querySelector('[data-outcome-mark="succeeded"]')?.hasAttribute("hidden"),
      ).toBe(true);
      expect(toastTexts("error")).toEqual(["Transaction was not confirmed"]);
      expect(toastTexts("success")).toEqual([]);
    });

    test(`a ${chainStatus} transfer leads with Try again, which reviews afresh`, async () => {
      const { app, calls, navigations } = await transferTo(chainStatus);
      const button = submitButtonOf(app);

      // One primary: the receipt's Try again. The form's control stays off the
      // receipt, and Activity, where the failure is looked up, steps down.
      expect(button.hidden).toBe(true);
      expect(button.disabled).toBe(true);
      expect(app.querySelector("#nft-send-form")?.getAttribute("data-stage")).toBe("failed");
      expect(actionsShown(app, "failed")).toBe(true);
      expect(actionsShown(app, "succeeded")).toBe(false);
      const [retry, activity] = Array.from(
        app.querySelectorAll<HTMLButtonElement>('[data-outcome-actions="failed"] button'),
      );
      expect(retry?.textContent).toBe("Try again");
      expect(retry?.classList.contains("secondary")).toBe(false);
      expect(activity?.textContent).toContain("View in Activity tab");
      expect(activity?.classList.contains("secondary")).toBe(true);
      activity?.click();
      expect(navigations).toEqual(["activity"]);

      // The same recipient, reviewed afresh: the refused fee is not reused.
      retry?.click();
      await flush();
      expect(calls.review).toHaveLength(2);
      expect(calls.transfer).toHaveLength(1);
      expect(app.querySelector("#nft-success")).toBeNull();
      expect(button.hidden).toBe(false);
      expect(button.textContent).toContain("Confirm transfer");

      submit(app);
      await flush();
      expect(calls.transfer).toHaveLength(2);
    });
  }

  test("a refusal that lands after the reader moved on leaves the new review alone", async () => {
    let answer = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { app, calls } = mount(undefined, {}, "reverted", gate);
    const input = recipientInput(app);
    input.value = RECIPIENT;
    submit(app);
    await flush();
    submit(app);
    await flush();
    await flush();

    // While the chain is still answering, the reader edits the recipient — which
    // clears the receipt — and reviews a new transfer.
    input.value = OTHER_RECIPIENT;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    submit(app);
    await flush();
    expect(submitButtonOf(app).textContent).toContain("Confirm transfer");

    answer();
    await flush();
    await flush();

    // The first transfer's refusal answers for a receipt no longer on screen.
    expect(submitButtonOf(app).textContent).toContain("Confirm transfer");
    expect(app.querySelector("#nft-send-form")?.getAttribute("data-stage")).toBe("review");
    expect(toastTexts("error")).toEqual([]);
    submit(app);
    await flush();
    expect(calls.transfer).toHaveLength(2);
    expect(sameFelt(calls.transfer[1]?.[3], OTHER_RECIPIENT)).toBe(true);
  });
});
