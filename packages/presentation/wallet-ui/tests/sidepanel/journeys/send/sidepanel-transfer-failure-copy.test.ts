/**
 * Every failed Send keeps the complete diagnostic for support.
 *
 * The receipt and its toasts show reader-facing sentences; the copy control on
 * each hands over the rejected call's own message instead — the cause behind
 * "Transaction was not sent", or the raw answer behind "The RPC rejected this
 * request". A failure with no rejected call behind it (a chain rejection)
 * copies the reason shown, never a diagnostic left over from an earlier try.
 * What is copied never carries an endpoint: a node's error that echoes the RPC
 * URL and its key arrives with the URL already redacted by the panel client.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { STRK20_PRIOR_WRITE_UNRESOLVED } from "@bramble/privacy/maturity";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { TransferState } from "../../../../src/sidepanel/journeys/send/transfer-model";
import {
  confirmedState,
  submitRejection,
  type TransferReview,
} from "../../../../src/sidepanel/journeys/send/transfer-submit";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { createSidepanelRuntime } from "../../../../src/sidepanel/runtime/runtime";
import { captureClipboard } from "../../../support/failure-copy-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  TRANSFER_RECIPIENT as RECIPIENT,
  setTransferField as setField,
  submitTransferForm as submit,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const RAW_RPC = "RPC: starknet_estimateFee with params {}";

const authorizing: TransferState<TransferReview> = {
  error: "",
  fields: null,
  privatePreparation: null,
  progress: null,
  requiresDeployment: false,
  review: null,
  reviewedKey: "key",
  stage: "authorizing",
  submissionUnknown: false,
  transactionHash: null,
};

describe("submitRejection keeps the diagnostic beside the sentence", () => {
  test("a refusal over an earlier private write", () => {
    const rejection = submitRejection(authorizing, new Error(STRK20_PRIOR_WRITE_UNRESOLVED));
    expect(rejection.state.priorWrite).toBe("unresolved");
    expect(rejection.state.errorDetails).toBe(STRK20_PRIOR_WRITE_UNRESOLVED);
  });

  test("an unknown outcome keeps the raw answer its sentence rewrote", () => {
    const rejection = submitRejection(authorizing, new Error(RAW_RPC));
    expect(rejection.state.submissionUnknown).toBe(true);
    expect(rejection.state.error).not.toContain(RAW_RPC);
    expect(rejection.state.errorDetails).toBe(RAW_RPC);
  });

  test("a typed unknown outcome keeps its curated message", () => {
    const message = "Transaction submission status is unknown.";
    const rejection = submitRejection(authorizing, new SubmissionUnknownError(message, null));
    expect(rejection.state.errorDetails).toBe(message);
  });

  test("a rejection that is not an Error keeps nothing, so the sentence is copied", () => {
    const rejection = submitRejection(authorizing, { message: RAW_RPC });
    expect(rejection.state.stage).toBe("failed");
    expect(rejection.state.errorDetails).toBe("");
  });
});

test("a chain rejection drops a diagnostic left from an earlier try", () => {
  const failed = confirmedState(
    { ...authorizing, errorDetails: "rejected-on-device", stage: "confirming" },
    { kind: "failed", message: "Starknet rejected this transaction.", toast: "Rejected" },
  );
  expect(failed.stage).toBe("failed");
  expect(failed.errorDetails).toBe("");
});

describe("the rendered public Send", () => {
  const reviewAndConfirm = async (app: HTMLElement): Promise<void> => {
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");
    submit(app);
    await flush();
    submit(app);
    await flush();
    await flush();
  };

  const lastToastCopy = (): HTMLButtonElement | null =>
    [...document.querySelectorAll<HTMLButtonElement>(".toast.error .toast-copy")].at(-1) ?? null;

  test("a refusal before sending: receipt and toast copy the cause, not the headline", async () => {
    const copied = captureClipboard();
    const { app, deps } = mount({
      async submitTransfer() {
        throw new Error("rejected-on-device");
      },
    });
    bindTransfer(deps);
    await reviewAndConfirm(app);

    expect(app.querySelector("#send-failure-copy")?.textContent).toBe(
      "The transaction was not sent. You rejected the request on your Ledger. Nothing was submitted.",
    );
    app
      .querySelector<HTMLButtonElement>('#send-failure [aria-label="Copy error details"]')
      ?.click();
    await flush();
    expect(document.querySelector(".toast.error .toast-text")?.textContent).toContain("not sent");
    lastToastCopy()?.click();
    await flush();
    expect(copied).toEqual(["rejected-on-device", "rejected-on-device"]);
  });

  test("a failed review's toast copies the raw answer behind its sentence", async () => {
    const copied = captureClipboard();
    const { app, deps } = mount({
      async reviewTransfer() {
        throw new Error(RAW_RPC);
      },
    });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");
    submit(app);
    await flush();

    expect(document.querySelector(".toast.error .toast-text")?.textContent).not.toContain(RAW_RPC);
    lastToastCopy()?.click();
    await flush();
    expect(copied).toEqual([RAW_RPC]);
  });

  test("a node error through the real client is copied without its endpoint", async () => {
    const key = "node-key-123";
    const runtime = createSidepanelRuntime({
      sendMessage: async () => ({
        error: `RPC: starknet_addInvokeTransaction with params {}\n\n 55: Account validation failed: {"url":"https://rpc.example.test/v0_8/${key}"}`,
      }),
    });
    const copied = captureClipboard();
    const { app, deps } = mount({
      submitTransfer: (...args: Parameters<typeof runtime.submitTransfer>) =>
        runtime.submitTransfer(...args),
    });
    bindTransfer(deps);
    await reviewAndConfirm(app);

    expect(app.querySelector("#send-failure-title")?.textContent).toBe("Status unknown");
    app
      .querySelector<HTMLButtonElement>('#send-failure [aria-label="Copy error details"]')
      ?.click();
    await flush();
    expect(copied).toEqual([
      'RPC: starknet_addInvokeTransaction with params {}\n\n 55: Account validation failed: {"url":"[endpoint]"}',
    ]);
    expect(app.textContent).not.toContain(key);
  });
});
