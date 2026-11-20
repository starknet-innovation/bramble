/**
 * A node submission refusal is the sentence on the approval result line.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { networkRejectionMessage } from "@bramble/starknet/node-rejection";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { bindApprovals } from "../../../../src/sidepanel/shell/dashboard-bindings";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { manualTimers } from "../../../support/manual-timers";

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

describe("approval network rejection", () => {
  test("shows a node submission refusal instead of a generic failure", async () => {
    const id = "c81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
    const sentence = networkRejectionMessage(
      "Calldata length exceeded maximum: length 5001 (allowed length: 5000)",
    );
    const host = document.createElement("div");
    host.innerHTML = `
      <article class="request-card">
        <button data-approval-action="approve" data-approval-id="${id}" data-approval-kind="invoke">Approve</button>
      </article>
      <section id="approval-live" hidden>
        <strong id="approval-live-title"></strong>
        <p id="approval-live-copy"></p>
      </section>
      <p id="approval-result"></p>`;
    document.body.replaceChildren(host);
    const stageTimers = manualTimers();
    bindApprovals({
      app: host,
      render: async () => undefined,
      stageTimers,
      wallet: {
        decideApproval: async () => {
          throw new Error(sentence);
        },
        loadStatus: async () => STATUS,
      } as unknown as SidepanelWallet,
    });

    host.querySelector<HTMLButtonElement>('[data-approval-action="approve"]')?.click();
    await flush();
    stageTimers.flush();
    await flush();

    expect(host.querySelector("#approval-result")?.textContent).toBe(sentence);
    expect(host.querySelector("#approval-result")?.textContent).not.toContain(
      "Something went wrong",
    );
  });
});
