/**
 * Approval decision bindings are single-flight per request. Approve, Deny, and
 * Review later lock together immediately; an executor error repaints from
 * background state so the consumed approval id cannot be decided a second time.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PendingApproval } from "../../../../src/popup/responses/approvals-responses";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { bindApprovals } from "../../../../src/sidepanel/shell/dashboard-bindings";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("bindApprovals", () => {
  test("locks every action and repaints after a consumed approval fails", async () => {
    const id = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
    const host = document.createElement("div");
    host.innerHTML = `
      <article class="request-card">
        <button data-approval-action="approve" data-approval-id="${id}">Approve</button>
        <button data-approval-action="deny" data-approval-id="${id}">Deny</button>
      </article>
      <section id="approval-live" hidden>
        <strong id="approval-live-title"></strong>
        <p id="approval-live-copy"></p>
      </section>
      <button data-approval-later="${id}">Later</button>
      <p id="approval-result"></p>`;
    document.body.replaceChildren(host);
    const decisions: boolean[] = [];
    let rejectDecision!: (error: Error) => void;
    const decision = new Promise<void>((_resolve, reject) => {
      rejectDecision = (error) => reject(error);
    });
    let renderCount = 0;
    const wallet = {
      async decideApproval(_id: string, approved: boolean) {
        decisions.push(approved);
        return decision;
      },
      async loadStatus() {
        return STATUS;
      },
    } as unknown as SidepanelWallet;

    bindApprovals({
      app: host,
      render: async () => {
        renderCount += 1;
      },
      wallet,
    });
    const approve = host.querySelector<HTMLButtonElement>('[data-approval-action="approve"]');
    const deny = host.querySelector<HTMLButtonElement>('[data-approval-action="deny"]');
    const later = host.querySelector<HTMLButtonElement>("[data-approval-later]");
    approve?.click();
    deny?.click();

    expect(decisions).toEqual([true]);
    expect(approve?.disabled).toBe(true);
    expect(deny?.disabled).toBe(true);
    expect(later?.disabled).toBe(true);
    expect(host.querySelector<HTMLElement>(".request-card")?.dataset["state"]).toBe("working");
    expect(host.querySelector<HTMLElement>("#approval-live")?.hidden).toBe(false);
    expect(host.querySelector("#approval-live-title")?.textContent).toBe("Authorizing request");
    expect(host.querySelector("#approval-live-copy")?.textContent).toContain(
      "locked while the wallet signs and submits",
    );
    expect(host.querySelector("#approval-result")?.textContent).toBe(
      "Approved. Signing and broadcasting…",
    );

    rejectDecision(new Error("Starknet rejected the declaration"));
    await flush();
    expect(renderCount).toBe(1);
  });

  test("completes a denial and lets Review later snooze without deciding", async () => {
    const id = "a1c8df5b-894d-44e7-a925-27b730d92dc8";
    const host = document.createElement("div");
    host.innerHTML = `
      <button data-approval-action="deny" data-approval-id="${id}">Deny</button>
      <button data-approval-later="${id}">Later</button>
      <p id="approval-live-title"></p>
      <p id="approval-live-copy"></p>
      <p id="approval-result"></p>`;
    document.body.replaceChildren(host);
    const decisions: boolean[] = [];
    const snoozed: string[] = [];
    let renders = 0;

    bindApprovals({
      app: host,
      render: async () => {
        renders += 1;
      },
      snoozeApproval: (approvalId) => {
        snoozed.push(approvalId);
      },
      wallet: {
        decideApproval: async (_approvalId: string, approved: boolean) => {
          decisions.push(approved);
        },
        loadStatus: async () => STATUS,
      } as unknown as SidepanelWallet,
    });

    host.querySelector<HTMLButtonElement>("[data-approval-later]")?.click();
    host.querySelector<HTMLButtonElement>("[data-approval-id]")?.click();
    await flush();

    expect(snoozed).toEqual([id]);
    expect(decisions).toEqual([false]);
    expect(host.querySelector("#approval-live-title")?.textContent).toBe("Denying request");
    expect(host.querySelector("#approval-live-copy")?.textContent).toContain("returning control");
    expect(host.querySelector("#approval-result")?.textContent).toBe("Rejecting request…");
    expect(renders).toBe(1);
  });
});

// A transaction card's decision must report the fee THAT PAINT displayed, not
// whatever the queue holds when the click arrives: a re-estimate fired from a
// second open wallet surface replaces the queue's copy while this card sits
// unrepainted, and approving it would then consent to a figure nobody read.
// Renderer and binding are exercised together here because the echo only holds
// if the same paint that showed the figure is the one that reports it.
describe("bindApprovals echoes the fee the card painted", () => {
  const INVOKE_ID = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
  const REVIEWED = { overallFee: "1000", unit: "FRI" } as const;

  const invokeApproval = (fee?: PendingApproval["fee"]): PendingApproval => ({
    ...(fee === undefined ? { feeEstimateFailed: true } : { fee }),
    id: INVOKE_ID,
    kind: "invoke",
    origin: "https://dapp.example",
    summaries: ["Send 1 ETH to 0x0511…e6f7"],
  });

  const clickApprove = async (
    approval: PendingApproval,
  ): Promise<readonly { readonly approved: boolean; readonly reviewedFee: unknown }[]> => {
    const host = document.createElement("div");
    host.innerHTML = `<ul>${approvalCard(approval, STATUS)}</ul><p id="approval-result"></p>`;
    document.body.replaceChildren(host);
    const decided: { readonly approved: boolean; readonly reviewedFee: unknown }[] = [];
    bindApprovals({
      app: host,
      render: async () => undefined,
      wallet: {
        decideApproval: async (_id: string, approved: boolean, reviewedFee?: unknown) => {
          decided.push({ approved, reviewedFee });
        },
        loadStatus: async () => STATUS,
      } as unknown as SidepanelWallet,
    });
    host.querySelector<HTMLButtonElement>('[data-approval-action="approve"]')?.click();
    await flush();
    return decided;
  };

  test("an approve click reports the figure the card rendered", async () => {
    const html = approvalCard(invokeApproval(REVIEWED), STATUS);
    expect(html).toContain('data-approval-fee="1000"');
    expect(html).toContain('data-approval-fee-unit="FRI"');

    expect(await clickApprove(invokeApproval(REVIEWED))).toEqual([
      { approved: true, reviewedFee: REVIEWED },
    ]);
  });

  test("a card that priced nothing cannot dispatch an approval", async () => {
    const html = approvalCard(invokeApproval(), STATUS);
    expect(html).not.toContain("data-approval-fee");
    expect(html).toContain('data-approval-action="approve"');
    expect(html).toContain('type="button" disabled');

    expect(await clickApprove(invokeApproval())).toEqual([]);
  });
});

// The fee-retry affordance on a queued invoke card asks the background to
// re-estimate and repaints on success; a failure re-enables the button and
// leaves the approval untouched (#189).
describe("bindApprovals fee retry", () => {
  test("re-estimates and repaints on success", async () => {
    const id = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
    const host = document.createElement("div");
    host.innerHTML = `<button data-approval-retry-fee="${id}">Retry fee estimate</button>`;
    document.body.replaceChildren(host);
    const retried: string[] = [];
    let renders = 0;

    bindApprovals({
      app: host,
      render: async () => {
        renders += 1;
      },
      wallet: {
        loadStatus: async () => STATUS,
        retryApprovalFee: async (approvalId: string) => {
          retried.push(approvalId);
        },
      } as unknown as SidepanelWallet,
    });
    host.querySelector<HTMLButtonElement>("[data-approval-retry-fee]")?.click();
    await flush();

    expect(retried).toEqual([id]);
    expect(renders).toBe(1);
  });

  test("a failed retry re-enables the button without deciding the approval", async () => {
    const id = "a1c8df5b-894d-44e7-a925-27b730d92dc8";
    const host = document.createElement("div");
    host.innerHTML = `<button data-approval-retry-fee="${id}">Retry fee estimate</button>`;
    document.body.replaceChildren(host);
    let renders = 0;

    bindApprovals({
      app: host,
      render: async () => {
        renders += 1;
      },
      wallet: {
        decideApproval: async () => {
          throw new Error("must not decide");
        },
        loadStatus: async () => STATUS,
        retryApprovalFee: async () => {
          throw new Error("wallet locked");
        },
      } as unknown as SidepanelWallet,
    });
    const button = host.querySelector<HTMLButtonElement>("[data-approval-retry-fee]");
    button?.click();
    expect(button?.disabled).toBe(true);
    await flush();

    expect(button?.disabled).toBe(false);
    expect(renders).toBe(0);
  });
});
