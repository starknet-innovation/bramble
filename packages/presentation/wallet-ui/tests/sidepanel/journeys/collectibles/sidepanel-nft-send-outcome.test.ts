/**
 * What the NFT send says after a confirm is rejected (errors audit F1, F3).
 * "Nothing was submitted" only for a refusal made before signing; a lost or
 * unrecognised reply may be on chain, so it reads as outcome unknown and the
 * reviewed transfer is not confirmed again.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { REQUEST_UNKNOWN } from "../../../../src/sidepanel/runtime/friendly-error-copy";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { flush, mount, RECIPIENT, recipientInput, submit } from "../../../support/nft-send-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

describe("NFT send rejections", () => {
  test("reports a pre-submit refusal with the recipient hint", async () => {
    const { app } = mount(undefined, {
      transfer: new Error("this account does not own that NFT"),
    });
    recipientInput(app).value = RECIPIENT;
    submit(app);
    await flush();
    submit(app);
    await flush();
    expect(app.querySelector("#nft-send-result")?.textContent).toBe(
      "This account doesn't own that collectible. Nothing was submitted; review the recipient and try again.",
    );
  });

  // Errors audit F1/F3: a lost or unrecognised reply may be on chain, so the
  // result never says nothing was submitted and Confirm is not re-armed.
  for (const [name, error] of [
    ["an unrecognised reply", new Error("nft transfer failed")],
    ["a lost reply", new SubmissionUnknownError(REQUEST_UNKNOWN, null)],
    [
      "the indeterminate-write sentence",
      new Error(
        "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
      ),
    ],
  ] as const) {
    test(`says the outcome is unknown after ${name}`, async () => {
      const { app, calls } = mount(undefined, { transfer: error });
      recipientInput(app).value = RECIPIENT;
      submit(app);
      await flush();
      submit(app);
      await flush();
      const line = app.querySelector("#nft-send-result")?.textContent ?? "";
      expect(line).toBe(
        error instanceof SubmissionUnknownError || name === "an unrecognised reply"
          ? "The transfer may not have gone through. Check Activity before trying again."
          : "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
      );
      expect(line).not.toContain("Nothing was submitted");
      submit(app);
      await flush();
      expect(calls.transfer).toHaveLength(1);
    });
  }
});
