/**
 * Confirm-and-execute review invariants: exact effects and fees precede one
 * explicit submission, mode/signer changes re-prepare, and failure is retryable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MultisigConfirmationMode } from "@mc-wallet/multisig/confirmation";
import type { MultisigProposalRecord, MultisigRecord } from "@mc-wallet/multisig/repository";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { MultisigUiDeps } from "../../src/sidepanel/multisig-ui";
import { multisigDetailFlow } from "../../src/sidepanel/multisig-views";
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

type ConfirmationInput = {
  readonly mode: MultisigConfirmationMode;
  readonly proposalId: string;
  readonly signerAccountId: string;
};

const client = (
  options: {
    readonly confirmed?: (input: ConfirmationInput) => Promise<string>;
    readonly feeFailure?: boolean;
    readonly prepared?: (input: ConfirmationInput) => void;
  } = {},
): MultisigUiDeps["multisig"] =>
  ({
    async confirmProposal(input: ConfirmationInput): Promise<string> {
      return options.confirmed?.(input) ?? "0xabc";
    },
    async prepareConfirmation(input: ConfirmationInput) {
      options.prepared?.(input);
      return {
        fee: options.feeFailure ? null : { overallFee: "1000", unit: "FRI" },
        feeEstimateFailed: options.feeFailure === true,
        ...input,
      };
    },
  }) as unknown as MultisigUiDeps["multisig"];

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

const openPanel = (proposal: MultisigProposalRecord, multisig = client()): HTMLElement | null => {
  const app = mountMultisigUi(
    multisigDetailFlow(status, signer, record, [proposal]),
    async () => {},
    {
      multisig,
    },
  );
  app.querySelector<HTMLButtonElement>(`[data-ms-confirm-open="${proposal.id}"]`)?.click();
  return app.querySelector<HTMLElement>(`[data-ms-confirm-panel="${proposal.id}"]`);
};

describe("multisig confirm-and-execute review", () => {
  test("reviews the exact effect, network, mode, signer, and fee before enabling submit", async () => {
    const prepared: ConfirmationInput[] = [];
    const submitted: ConfirmationInput[] = [];
    const proposal = makeProposal();
    const panel = openPanel(
      proposal,
      client({
        confirmed: async (input) => {
          submitted.push(input);
          return "0xabc";
        },
        prepared: (input) => prepared.push(input),
      }),
    );

    expect(panel?.textContent).toContain("Treasury");
    expect(panel?.textContent).toContain("Starknet Mainnet");
    expect(panel?.textContent).toContain("Call transfer on");
    expect(panel?.querySelectorAll("[data-ms-confirm-mode-option]")).toHaveLength(2);
    const submit = panel?.querySelector<HTMLButtonElement>("[data-ms-confirm-submit]");
    expect(submit?.disabled).toBe(true);

    await flush();
    expect(prepared[0]?.mode).toBe("confirm-and-execute");
    expect(panel?.querySelector("[data-ms-confirm-fee]")?.textContent).toContain("STRK");
    expect(submit?.disabled).toBe(false);
    submit?.click();
    await flush();
    expect(submitted).toEqual([
      {
        mode: "confirm-and-execute",
        proposalId: proposal.id,
        signerAccountId: signer.id,
      },
    ]);
  });

  test("switching to confirm-only re-prepares and submits only that mode", async () => {
    const prepared: MultisigConfirmationMode[] = [];
    const submitted: MultisigConfirmationMode[] = [];
    const panel = openPanel(
      makeProposal(),
      client({
        confirmed: async (input) => {
          submitted.push(input.mode);
          return "0xabc";
        },
        prepared: (input) => prepared.push(input.mode),
      }),
    );
    await flush();
    panel
      ?.querySelector<HTMLButtonElement>('[data-ms-confirm-mode-option="confirm-only"]')
      ?.click();
    await flush();
    expect(prepared).toEqual(["confirm-and-execute", "confirm-only"]);
    const submit = panel?.querySelector<HTMLButtonElement>("[data-ms-confirm-submit]");
    expect(submit?.textContent).toContain("Confirm proposal");
    submit?.click();
    await flush();
    expect(submitted).toEqual(["confirm-only"]);
  });

  test("a non-quorum confirmation exposes only confirm-only mode", async () => {
    const prepared: MultisigConfirmationMode[] = [];
    const panel = openPanel(
      makeProposal({ confirmations: 0, confirmedSignerAddresses: [] }),
      client({ prepared: (input) => prepared.push(input.mode) }),
    );
    await flush();
    expect(panel?.querySelector("[data-ms-confirm-mode-option]")).toBeNull();
    expect(panel?.dataset["msConfirmMode"]).toBe("confirm-only");
    expect(prepared).toEqual(["confirm-only"]);
  });

  test("a failed fee estimate keeps signing blocked and exposes retry", async () => {
    const panel = openPanel(makeProposal(), client({ feeFailure: true }));
    await flush();
    expect(panel?.querySelector<HTMLButtonElement>("[data-ms-confirm-submit]")?.disabled).toBe(
      true,
    );
    expect(panel?.querySelector<HTMLButtonElement>("[data-ms-confirm-retry-fee]")?.hidden).toBe(
      false,
    );
    expect(panel?.querySelector("[data-ms-confirm-status]")?.textContent).toContain(
      "Retry before signing",
    );
  });

  test("a failed submission restores controls and reports the actionable error", async () => {
    const panel = openPanel(
      makeProposal(),
      client({
        confirmed: async () => {
          throw new Error("RPC unavailable");
        },
      }),
    );
    await flush();
    const submit = panel?.querySelector<HTMLButtonElement>("[data-ms-confirm-submit]");
    submit?.click();
    expect(submit?.hasAttribute("data-busy")).toBe(true);
    await flush();
    expect(submit?.disabled).toBe(false);
    expect(panel?.querySelector("[data-ms-confirm-status]")?.textContent).toBe("RPC unavailable");
  });

  test("success is reported as submitted, not already executed", async () => {
    const panel = openPanel(makeProposal());
    await flush();
    panel?.querySelector<HTMLButtonElement>("[data-ms-confirm-submit]")?.click();
    await flush();
    const toast = document.querySelector("#toast-stack .toast-text")?.textContent ?? "";
    expect(toast).toBe("Confirm & execute submitted");
  });
});
