/**
 * Confirm-and-execute affordance: the combined action is offered only to the
 * signer whose confirmation reaches quorum on a proposal whose original call is
 * known locally, it states that a failed execution also drops the confirmation,
 * and clicking it asks the client to batch rather than to plain-confirm.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MultisigUiDeps } from "../../src/sidepanel/multisig-ui";
import { multisigDetailFlow } from "../../src/sidepanel/multisig-views";
import type { MultisigProposalRecord, MultisigRecord } from "../../src/storage/multisig-store";
import type { AccountRef } from "../../src/storage/vault-schema";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { mountMultisigUi } from "../support/multisig-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const OTHER_SIGNER = "0x234";

const signer: AccountRef = {
  address: "0x123",
  classHash: "0x456",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN",
  publicKeyX: "0x789",
  publicKeyY: "0xabc",
};

const status = {
  accountCount: 1,
  accounts: [signer],
  activeAccountId: signer.id,
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
  signers: [signer.address, OTHER_SIGNER],
};

// One confirmation already banked on a 2-of-2, so this signer's confirmation is
// the last quorum needs. `call` present means it can also be executed here.
const makeProposal = (overrides: Partial<MultisigProposalRecord> = {}): MultisigProposalRecord => ({
  call: { calldata: ["0x1"], contractAddress: "0x456", entrypoint: "transfer", salt: "0x0" },
  confirmations: 1,
  confirmedBySigner: false,
  confirmedSignerAddresses: [OTHER_SIGNER],
  id: `${record.id}:0x789`,
  multisigId: record.id,
  state: "pending",
  summary: "Pay contributor",
  txId: "0x789",
  ...overrides,
});

const openPanel = (
  proposal: MultisigProposalRecord,
  overrides: Partial<MultisigUiDeps> = {},
): HTMLElement | null => {
  const app = mountMultisigUi(
    multisigDetailFlow(status, signer, record, [proposal]),
    async () => {},
    overrides,
  );
  app.querySelector<HTMLButtonElement>(`[data-ms-confirm-open="${proposal.id}"]`)?.click();
  return app.querySelector<HTMLElement>(`[data-ms-confirm-panel="${proposal.id}"]`);
};

describe("multisig confirm-and-execute affordance", () => {
  test("the quorum-reaching signer can confirm and execute in one action", async () => {
    const flags: (boolean | undefined)[] = [];
    const proposal = makeProposal();
    const panel = openPanel(proposal, {
      multisig: {
        async confirmProposal(_id: string, _untrackedVerified?: boolean, andExecute?: boolean) {
          flags.push(andExecute);
          return "0xabc";
        },
      } as MultisigUiDeps["multisig"],
    });

    const combined = panel?.querySelector<HTMLButtonElement>("[data-ms-and-execute]");
    expect(combined?.textContent).toContain("Confirm & execute");
    expect(panel?.querySelectorAll("[data-ms-confirm-submit]")).toHaveLength(2);
    // The atomicity consequence must be stated where the decision is made.
    expect(panel?.querySelector(".review-panel")?.textContent).toContain(
      "your confirmation is not recorded either",
    );

    combined?.click();
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    expect(flags).toEqual([true]);
  });

  test("the confirm-only action alongside it does not ask to execute", async () => {
    const flags: (boolean | undefined)[] = [];
    const proposal = makeProposal();
    const panel = openPanel(proposal, {
      multisig: {
        async confirmProposal(_id: string, _untrackedVerified?: boolean, andExecute?: boolean) {
          flags.push(andExecute);
          return "0xabc";
        },
      } as MultisigUiDeps["multisig"],
    });

    const confirmOnly = [
      ...(panel?.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-submit]") ?? []),
    ].find((entry) => entry.dataset["msAndExecute"] !== "true");
    expect(confirmOnly?.textContent).toContain("Confirm only");

    confirmOnly?.click();
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    expect(flags).toEqual([undefined]);
  });

  test("a signer who is not the last one quorum needs sees only a plain confirm", () => {
    // 1 of 3 confirmations on a 2-of-2 record raised to 3 signers: confirming
    // brings it to 2 of 3, so execution is still someone else's step.
    const panel = openPanel(makeProposal({ confirmations: 0, confirmedSignerAddresses: [] }));
    expect(panel?.querySelector("[data-ms-and-execute]")).toBeNull();
    expect(panel?.querySelectorAll("[data-ms-confirm-submit]")).toHaveLength(1);
    expect(panel?.querySelector(".review-panel")?.textContent).toContain(
      "It does not execute the proposal",
    );
  });

  test("a proposal tracked by id only offers no combined action", () => {
    // Reaches quorum, but without the original call it can never be executed
    // from here, so only the plain confirmation is offered.
    const panel = openPanel(makeProposal({ call: null, summary: "Shared by id" }));
    expect(panel?.querySelector("[data-ms-and-execute]")).toBeNull();
    expect(panel?.querySelectorAll("[data-ms-confirm-submit]")).toHaveLength(1);
    expect(panel?.querySelector(".review-panel")?.textContent).toContain(
      "executing needs the wallet that proposed it",
    );
  });
});
