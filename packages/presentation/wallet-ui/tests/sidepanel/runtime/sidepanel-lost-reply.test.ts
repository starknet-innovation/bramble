/**
 * A write whose reply the browser lost (errors audit F3).
 *
 * `chrome.runtime.sendMessage` rejects with the browser's own words when the
 * worker stopped or never answered. For a write that says nothing about
 * whether the request ran, so the panel clients type it as outcome unknown;
 * a read may still say "try again".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { createMultisigClient } from "../../../src/sidepanel/journeys/multisig/multisig-runtime";
import { bindAllowances } from "../../../src/sidepanel/journeys/portfolio/allowance-ui";
import { createSwapClient } from "../../../src/sidepanel/journeys/swap/swap-client";
import { friendlyError } from "../../../src/sidepanel/runtime/friendly-error";
import {
  REQUEST_FAILED,
  REQUEST_UNKNOWN,
} from "../../../src/sidepanel/runtime/friendly-error-copy";
import {
  createSidepanelRuntime,
  type SidepanelWallet,
} from "../../../src/sidepanel/runtime/runtime";
import { READ_ONLY_MESSAGES } from "../../../src/sidepanel/runtime/runtime-errors";
import { bindApprovals } from "../../../src/sidepanel/shell/dashboard-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";
import { manualTimers } from "../../support/manual-timers";

const PORT_CLOSED = "The message port closed before a response was received.";
const NO_RECEIVER = "Could not establish connection. Receiving end does not exist.";
const lost = { sendMessage: () => Promise.reject(new Error(PORT_CLOSED)) };

const rejection = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

describe("a lost reply on a write call", () => {
  const wallet = createSidepanelRuntime(lost);
  const writes: readonly (readonly [string, () => Promise<unknown>])[] = [
    ["an approval decision", () => wallet.decideApproval("id", true)],
    ["a denial", () => wallet.decideApproval("id", false)],
    ["an allowance revoke", () => wallet.revokeAllowance("id", { overallFee: "1", unit: "FRI" })],
    ["a site revoke", () => wallet.revokeOrigin("https://example.com")],
    ["a send", () => wallet.submitTransfer("a", "t", "0x1", "1")],
    ["a saved setting", () => wallet.setDisplay({ theme: "dark" })],
    ["a swap", () => createSwapClient(lost).execute("prep")],
    ["a multisig submission", () => createMultisigClient(lost).submitIntent("intent")],
  ];
  for (const [name, run] of writes) {
    test(`${name} is outcome unknown, never raw browser text`, async () => {
      const error = await rejection(run);
      expect(error).toBeInstanceOf(SubmissionUnknownError);
      expect((error as SubmissionUnknownError).transactionHash).toBeNull();
      expect((error as Error).message).toBe(REQUEST_UNKNOWN);
      expect((error as Error).message).not.toContain("message port");
    });
  }
});

describe("a lost reply on a read call", () => {
  test("passes the browser's rejection through, which reads as try again", async () => {
    const error = await rejection(() => createSidepanelRuntime(lost).loadPreferences());
    expect(error).not.toBeInstanceOf(SubmissionUnknownError);
    expect(friendlyError((error as Error).message).message).toBe(REQUEST_FAILED);
    expect(friendlyError(NO_RECEIVER).message).toBe(REQUEST_FAILED);
  });

  test("every read-only type is one the panel sends, and none is a refreshing mutation", () => {
    const root = join(import.meta.dir, "../../../src");
    const refresh = readFileSync(join(root, "sidepanel/app/sync/runtime-refresh.ts"), "utf8");
    const mutating = new Set([...refresh.matchAll(/"(wallet\.[A-Za-z0-9]+)"/g)].map((m) => m[1]));
    for (const type of READ_ONLY_MESSAGES) {
      expect(type.startsWith("wallet."), type).toBe(true);
      expect(mutating.has(type), type).toBe(false);
    }
  });
});

describe("unrecognised replies to a write", () => {
  test("approval and revoke fallbacks no longer claim a certain failure", () => {
    expect(friendlyError("approval failed").message).toBe(REQUEST_UNKNOWN);
    expect(friendlyError("revoke failed").message).toBe(REQUEST_UNKNOWN);
  });
});

describe("the approval decision sink", () => {
  beforeAll(registerDom);
  afterAll(unregisterDom);
  beforeEach(() => document.body.replaceChildren());

  test("shows a lost reply as an amber outcome-unknown line", async () => {
    const id = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
    const host = document.createElement("div");
    host.innerHTML = `
      <article class="request-card">
        <button data-approval-action="approve" data-approval-id="${id}">Approve</button>
      </article>
      <p id="approval-result"></p>`;
    document.body.replaceChildren(host);
    const stageTimers = manualTimers();
    const runtime = createSidepanelRuntime(lost);
    bindApprovals({
      app: host,
      render: async () => undefined,
      stageTimers,
      wallet: { ...runtime, loadStatus: async () => ({}) } as unknown as SidepanelWallet,
    });
    host.querySelector<HTMLButtonElement>('[data-approval-action="approve"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    stageTimers.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const toast = document.querySelector(".toast");
    expect(toast?.classList.contains("warning")).toBe(true);
    expect(toast?.querySelector(".toast-text")?.textContent).toBe(REQUEST_UNKNOWN);
    expect(host.querySelector("#approval-result")?.textContent).toBe(REQUEST_UNKNOWN);
  });
});

describe("the allowance revoke sink", () => {
  beforeAll(registerDom);
  afterAll(unregisterDom);

  const revokeWith = async (failure: Error): Promise<HTMLButtonElement | null> => {
    const host = document.createElement("div");
    host.innerHTML = `<div class="allowance-row">
        <button data-revoke-allowance="a1">Revoke</button>
        <p data-allowance-review-for="a1" hidden></p>
      </div>
      <p id="allowance-result"></p>`;
    document.body.replaceChildren(host);
    bindAllowances({
      app: host,
      render: async () => undefined,
      wallet: {
        revokeAllowance: async () => {
          throw failure;
        },
      } as unknown as SidepanelWallet,
    });
    const button = host.querySelector<HTMLButtonElement>("[data-revoke-allowance]");
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return button;
  };

  test("a lost reply is amber and does not re-arm the revoke", async () => {
    const button = await revokeWith(new SubmissionUnknownError(REQUEST_UNKNOWN, null));
    expect(document.querySelector(".toast")?.classList.contains("warning")).toBe(true);
    expect(document.querySelector("#allowance-result")?.textContent).toBe(REQUEST_UNKNOWN);
    expect(button?.disabled).toBe(true);
  });

  test("a known failure stays red and re-enables the revoke", async () => {
    const button = await revokeWith(new Error("allowance not found"));
    expect(document.querySelector(".toast")?.classList.contains("error")).toBe(true);
    expect(button?.disabled).toBe(false);
  });
});
