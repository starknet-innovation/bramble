/**
 * Approval decision bindings are single-flight per request. Approve, Deny, and
 * Review later lock together immediately; an executor error repaints from
 * background state so the consumed approval id cannot be decided a second time.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { bindApprovals } from "../../src/sidepanel/dashboard-bindings";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import { registerDom, unregisterDom } from "../support/groups-harness";

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
    host.innerHTML = `<button data-approval-action="approve" data-approval-id="${id}">Approve</button><button data-approval-action="deny" data-approval-id="${id}">Deny</button><button data-approval-later="${id}">Later</button><p id="approval-result"></p>`;
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
    expect(host.querySelector("#approval-result")?.textContent).toBe(
      "Approved. Signing and broadcasting…",
    );

    rejectDecision(new Error("Starknet rejected the declaration"));
    await flush();
    expect(renderCount).toBe(1);
  });
});
