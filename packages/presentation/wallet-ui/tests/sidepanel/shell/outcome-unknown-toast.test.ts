/**
 * A write whose outcome is unknown is not a failure (issue 382). Its toast
 * takes the amber warning tone, never the red error one, on the lanes that
 * report it with a toast: an account deployment and a dapp request the user
 * approved. A determinate failure on the same lanes stays red.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { INDETERMINATE_RPC_WRITE_MESSAGE } from "@bramble/starknet/provider";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import type { SidepanelWallet } from "../../../src/sidepanel/runtime/runtime";
import { isOutcomeUnknown } from "../../../src/sidepanel/runtime/runtime-errors";
import { showToast } from "../../../src/sidepanel/shared/dom";
import { bindApprovals } from "../../../src/sidepanel/shell/dashboard-bindings";
import { bindDeploy, type ShellBindingDeps } from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";
import { manualTimers } from "../../support/manual-timers";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const tones = (): string[] =>
  Array.from(document.querySelectorAll(".toast")).map((toast) =>
    toast.classList.contains("warning")
      ? "warning"
      : toast.classList.contains("error")
        ? "error"
        : "success",
  );

const STATUS: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

describe("isOutcomeUnknown", () => {
  test("recognises a typed unknown submission and the indeterminate sentence only", () => {
    expect(isOutcomeUnknown(new SubmissionUnknownError("status unknown", null))).toBe(true);
    expect(isOutcomeUnknown(new Error(INDETERMINATE_RPC_WRITE_MESSAGE))).toBe(true);
    expect(isOutcomeUnknown(new Error("Nonce too old"))).toBe(false);
    expect(isOutcomeUnknown(INDETERMINATE_RPC_WRITE_MESSAGE)).toBe(false);
  });
});

describe("warning toast", () => {
  test("keeps the error toast's copy control but not its danger tone", () => {
    showToast(INDETERMINATE_RPC_WRITE_MESSAGE, "warning", document.body);

    const toast = document.querySelector(".toast");
    expect(toast?.classList.contains("warning")).toBe(true);
    expect(toast?.classList.contains("error")).toBe(false);
    expect(toast?.querySelector(".toast-copy")).not.toBeNull();
    expect(toast?.querySelector(".toast-text")?.textContent).toBe(INDETERMINATE_RPC_WRITE_MESSAGE);
  });
});

const deployWith = async (failure: Error): Promise<void> => {
  const container = document.createElement("div");
  container.id = "app";
  container.innerHTML = `<section class="section">
      <section id="deploy-review-stage">
        <button id="deploy-button" type="button">Deploy</button>
        <div id="deploy-review"></div>
        <p role="status"></p>
      </section>
    </section>`;
  document.body.replaceChildren(container);
  const quote = { overallFee: "1000000000000000", unit: "FRI" as const };
  bindDeploy({
    app: container,
    render: async () => undefined,
    setActiveView: () => undefined,
    wallet: {
      deployAccount: async (fee?: typeof quote) => {
        if (!fee) return quote;
        throw failure;
      },
    } as unknown as ShellBindingDeps["wallet"],
  });
  await tick();
  container.querySelector<HTMLButtonElement>("#deploy-button")?.click();
  await tick();
};

describe("deployment whose reply was lost", () => {
  test("toasts a warning", async () => {
    await deployWith(new SubmissionUnknownError(INDETERMINATE_RPC_WRITE_MESSAGE, null));
    expect(tones()).toEqual(["warning"]);
  });

  test("a determinate failure still toasts an error", async () => {
    await deployWith(new Error("Nonce too old"));
    expect(tones()).toEqual(["error"]);
  });
});

const approveWith = async (failure: Error): Promise<void> => {
  const id = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
  const host = document.createElement("div");
  host.innerHTML = `
    <article class="request-card">
      <button data-approval-action="approve" data-approval-id="${id}">Approve</button>
    </article>
    <p id="approval-result"></p>`;
  document.body.replaceChildren(host);
  const stageTimers = manualTimers();
  bindApprovals({
    app: host,
    render: async () => undefined,
    stageTimers,
    wallet: {
      decideApproval: async () => {
        throw failure;
      },
      loadStatus: async () => STATUS,
    } as unknown as SidepanelWallet,
  });
  host.querySelector<HTMLButtonElement>('[data-approval-action="approve"]')?.click();
  await tick();
  // The outcome paints once "Authorizing request" has had its time on screen.
  stageTimers.flush();
  await tick();
};

describe("approved request whose reply was lost", () => {
  test("toasts a warning", async () => {
    await approveWith(new Error(INDETERMINATE_RPC_WRITE_MESSAGE));
    expect(tones()).toEqual(["warning"]);
  });

  test("a determinate failure still toasts an error", async () => {
    await approveWith(new Error("Request expired"));
    expect(tones()).toEqual(["error"]);
  });
});
