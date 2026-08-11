/**
 * Multisig DOM bindings at the response/UI boundary: acknowledgement toggles
 * cannot re-enable a statically forbidden signer action, and explicit retry
 * controls rehydrate instead of leaving a false empty state.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { MultisigProposalRecord, MultisigRecord } from "@mc-wallet/multisig/repository";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { serializeMultisigReviewPackage } from "../../../../src/sidepanel/journeys/multisig/multisig-model";
import type { MultisigUiDeps } from "../../../../src/sidepanel/journeys/multisig/multisig-ui";
import { multisigDetailFlow } from "../../../../src/sidepanel/journeys/multisig/multisig-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { mountMultisigUi as mount } from "../../../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("bindMultisigs", () => {
  test("acknowledgement enables only actions allowed by signer state", () => {
    const app = mount(`
      <div class="allowance-row">
        <input type="checkbox" data-ms-ack />
        <button data-ms-requires-ack="true" data-ms-action-allowed="true" disabled></button>
        <button data-ms-requires-ack="true" data-ms-action-allowed="false" disabled></button>
      </div>`);
    const checkbox = app.querySelector<HTMLInputElement>("[data-ms-ack]");
    const buttons = app.querySelectorAll<HTMLButtonElement>("[data-ms-requires-ack]");
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change"));
    }
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(true);
  });

  test("the list error retry requests a fresh render", async () => {
    let renders = 0;
    const app = mount('<button id="multisig-list-retry" type="button"></button>', async () => {
      renders += 1;
    });
    app.querySelector<HTMLButtonElement>("#multisig-list-retry")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(renders).toBe(1);
  });

  test("watching exposes immediate progress and completes with a refreshed account list", async () => {
    let finish: (() => void) | undefined;
    let renders = 0;
    const verification = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const app = mount(
      `<form id="multisig-add-form">
        <input name="address" value="0x123" />
        <input name="name" value="Treasury" />
        <button type="submit">Verify and watch</button>
        <p id="multisig-add-result" role="status"></p>
      </form>`,
      async () => {
        renders += 1;
      },
      {
        multisig: {
          async addMultisig() {
            await verification;
          },
        } as unknown as MultisigUiDeps["multisig"],
      },
    );
    const button = app.querySelector<HTMLButtonElement>('button[type="submit"]');
    app.querySelector<HTMLFormElement>("#multisig-add-form")?.requestSubmit();
    await Promise.resolve();

    expect(button?.disabled).toBe(true);
    expect(button?.hasAttribute("data-busy")).toBe(true);
    expect(app.querySelector("#multisig-add-result")?.textContent).toBe("Contacting Starknet…");

    finish?.();
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
    }
    expect(renders).toBe(1);
  });

  test("a stalled watch fails visibly and releases the form", async () => {
    const nativeSetTimeout = globalThis.setTimeout;
    const timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 15_000) {
        queueMicrotask(() => {
          if (typeof callback === "function") {
            callback(...args);
          }
        });
        return 0;
      }
      return nativeSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout);
    try {
      const app = mount(
        `<form id="multisig-add-form">
          <input name="address" value="0x123" />
          <button type="submit">Verify and watch</button>
          <p id="multisig-add-result" role="status"></p>
        </form>`,
        async () => {},
        {
          multisig: {
            async addMultisig() {
              await new Promise(() => {});
            },
          } as unknown as MultisigUiDeps["multisig"],
        },
      );
      const button = app.querySelector<HTMLButtonElement>('button[type="submit"]');
      app.querySelector<HTMLFormElement>("#multisig-add-form")?.requestSubmit();

      for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve();
      }

      expect(app.querySelector("#multisig-add-result")?.textContent).toBe(
        "Multisig verification took too long. Check the RPC endpoint and retry.",
      );
      expect(button?.disabled).toBe(false);
      expect(button?.hasAttribute("data-busy")).toBe(false);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test("the declare control submits once and exposes immediate progress", async () => {
    let declarations = 0;
    let renders = 0;
    let finish: ((transactionHash: string) => void) | undefined;
    const submitted = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const app = mount(
      `<button id="multisig-declare" type="button">Declare multisig class</button>
       <p id="multisig-declare-result" role="status"></p>`,
      async () => {
        renders += 1;
      },
      {
        multisig: {
          async declareClass() {
            declarations += 1;
            return submitted;
          },
        } as MultisigUiDeps["multisig"],
      },
    );
    const declareButton = app.querySelector<HTMLButtonElement>("#multisig-declare");
    declareButton?.click();
    declareButton?.click();
    await Promise.resolve();

    expect(declarations).toBe(1);
    expect(declareButton?.disabled).toBe(true);
    expect(declareButton?.hasAttribute("data-busy")).toBe(true);
    expect(app.querySelector("#multisig-declare-result")?.textContent).toBe("Submitting declare…");

    finish?.("0xdec");
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
    }
    expect(renders).toBe(1);
  });

  test("requires a stable review before creating a proposal", async () => {
    const proposals: unknown[] = [];
    const app = mount(
      `<form id="multisig-propose-form" data-proposal-mode="advanced" data-signer-account-id="SN_MAIN:0x123">
        <input name="summary" value="Pay contributor" />
        <input name="to" value="0x123" />
        <input name="entrypoint" value="transfer" />
        <textarea name="calldata">0x456, 0x1</textarea>
        <input name="salt" value="0x789" />
        <div id="multisig-propose-review"></div>
        <button type="submit">Review proposal</button>
        <p id="multisig-propose-result"></p>
      </form>`,
      async () => {},
      {
        multisig: {
          async proposeTransaction(proposal) {
            proposals.push(proposal);
            return "0xabc";
          },
        } as MultisigUiDeps["multisig"],
        selectedMultisigId: () => "SN_MAIN:0x999",
      },
    );
    const form = app.querySelector<HTMLFormElement>("#multisig-propose-form");
    const submit = app.querySelector<HTMLButtonElement>('button[type="submit"]');

    form?.requestSubmit();
    expect(proposals).toEqual([]);
    expect(form?.dataset["proposalStage"]).toBe("review");
    expect(app.querySelector("#multisig-propose-review")?.textContent).toContain(
      "Transaction details",
    );
    expect(submit?.textContent).toContain("Review proposal");

    form?.requestSubmit();
    await Promise.resolve();
    expect(proposals).toEqual([
      {
        calldata: ["0x456", "0x1"],
        entrypoint: "transfer",
        multisigId: "SN_MAIN:0x999",
        salt: "0x789",
        signerAccountId: "SN_MAIN:0x123",
        summary: "Pay contributor",
        to: "0x123",
      },
    ]);
  });

  test("imports a review package into the selected multisig tracking flow", async () => {
    const multisig: MultisigRecord = {
      address: "0x999",
      id: "SN_MAIN:0x999",
      networkId: "SN_MAIN",
      quorum: 1,
      signers: ["0x123"],
    };
    const proposal: MultisigProposalRecord = {
      call: {
        calldata: ["0x1"],
        contractAddress: "0x456",
        entrypoint: "transfer",
        salt: "0x2",
      },
      confirmations: 0,
      id: `${multisig.id}:0x789`,
      multisigId: multisig.id,
      state: "pending",
      summary: "Pay contributor",
      txId: "0x789",
    };
    const tracked: unknown[] = [];
    const app = mount(
      `<form id="multisig-track-form">
        <input name="txId" />
        <input name="summary" />
        <textarea name="reviewPackage"></textarea>
        <button type="submit">Track</button>
        <p id="multisig-track-result"></p>
      </form>`,
      async () => {},
      {
        multisig: {
          async trackProposal(...args: unknown[]) {
            tracked.push(args);
          },
        } as unknown as MultisigUiDeps["multisig"],
        selectedMultisigId: () => multisig.id,
      },
    );
    const packageInput = app.querySelector<HTMLTextAreaElement>('textarea[name="reviewPackage"]');
    if (packageInput) {
      packageInput.value = serializeMultisigReviewPackage(multisig, proposal);
    }
    app.querySelector<HTMLFormElement>("#multisig-track-form")?.requestSubmit();
    await Promise.resolve();

    expect(tracked).toEqual([[multisig.id, proposal.txId, proposal.summary, proposal.call]]);
  });

  test("reviews a confirmation with another owned signer without switching portfolios", async () => {
    const first: AccountRef = {
      address: "0x123",
      classHash: "0x456",
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
      id: "SN_MAIN:0x123",
      networkId: "SN_MAIN",
      publicKeyX: "0x789",
      publicKeyY: "0xabc",
    };
    const second: AccountRef = {
      ...first,
      address: "0x234",
      derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" },
      id: "SN_MAIN:0x234",
      publicKeyX: "0x890",
      publicKeyY: "0xbcd",
    };
    const status = {
      accountCount: 2,
      accounts: [first, second],
      activeAccountId: first.id,
      hasVault: true,
      locked: false,
      network: "Starknet Mainnet",
      networkId: "SN_MAIN",
      networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
      ready: true,
    } as const;
    const record: MultisigRecord = {
      address: "0x999",
      id: "SN_MAIN:0x999",
      name: "Treasury",
      networkId: "SN_MAIN",
      quorum: 2,
      signers: [first.address, second.address],
    };
    const proposal: MultisigProposalRecord = {
      call: { calldata: ["0x1"], contractAddress: "0x456", entrypoint: "transfer", salt: "0x0" },
      confirmations: 1,
      confirmedBySigner: true,
      confirmedBySignerAddress: first.address,
      confirmedSignerAddresses: [first.address],
      id: `${record.id}:0x789`,
      multisigId: record.id,
      state: "pending",
      summary: "Pay contributor",
      txId: "0x789",
    };
    const calls: string[] = [];
    const app = mount(
      multisigDetailFlow(status, first, record, [proposal]),
      async () => {
        calls.push("render");
      },
      {
        multisig: {
          async confirmProposal(input: { proposalId: string; signerAccountId: string }) {
            calls.push(`confirm:${input.proposalId}:${input.signerAccountId}`);
            return "0xabc";
          },
          async prepareConfirmation(input: {
            mode: "confirm-and-execute" | "confirm-only";
            proposalId: string;
            signerAccountId: string;
          }) {
            return {
              fee: { overallFee: "1", unit: "FRI" },
              feeEstimateFailed: false,
              ...input,
            };
          },
        } as unknown as MultisigUiDeps["multisig"],
        wallet: {
          async loadStatus() {
            return status;
          },
        } as unknown as MultisigUiDeps["wallet"],
      },
    );

    expect(app.querySelector(`[data-ms-confirm-signer="${first.id}"]`)).toBeNull();
    const open = app.querySelector<HTMLButtonElement>(`[data-ms-confirm-open="${proposal.id}"]`);
    open?.click();
    const panel = app.querySelector<HTMLElement>(`[data-ms-confirm-panel="${proposal.id}"]`);
    expect(panel?.hidden).toBe(false);
    expect(
      panel?.querySelector(`[data-ms-confirm-signer="${second.id}"]`)?.getAttribute("aria-pressed"),
    ).toBe("true");

    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    panel?.querySelector<HTMLButtonElement>("[data-ms-confirm-submit]")?.click();
    expect(panel?.querySelector("[data-ms-confirm-status]")?.textContent).toBe(
      "Authorizing one atomic confirmation and execution…",
    );
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    expect(calls).toEqual([`confirm:${proposal.id}:${second.id}`, "render"]);
  });
});
