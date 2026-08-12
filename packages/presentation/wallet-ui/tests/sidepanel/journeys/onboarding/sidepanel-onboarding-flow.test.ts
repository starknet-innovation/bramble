/**
 * Staged onboarding interaction checks. The runtime is a fixture-only boundary:
 * generated/imported words enter preview first, account selection is explicit,
 * and persistence happens only after the final Mainnet acknowledgement.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MNEMONIC = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
const PASSPHRASE = "fixture vault passphrase";

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
};

const account: AccountRef = {
  address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  classHash: "0x023456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  networkId: "SN_MAIN",
  publicKeyX: "0x123",
  publicKeyY: "0x456",
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setValue = (root: ParentNode, selector: string, value: string): void => {
  const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (!input) {
    throw new Error(`missing ${selector}`);
  }
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const click = (root: ParentNode, selector: string): void => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`missing ${selector}`);
  }
  button.click();
};

const cellsOf = (root: ParentNode, kind: "generated" | "import"): readonly HTMLElement[] =>
  Array.from(
    root.querySelectorAll<HTMLElement>(`[data-recovery-grid="${kind}"] .recovery-word-cell`),
  );

const inputOf = (cell: HTMLElement): HTMLInputElement => {
  const input = cell.querySelector<HTMLInputElement>("input.recovery-word");
  if (!input) {
    throw new Error("missing recovery word input");
  }
  return input;
};

const positionOf = (cell: HTMLElement): number =>
  Number(cell.querySelector("span")?.textContent ?? Number.NaN);

const wordOf = (cell: HTMLElement): string => inputOf(cell).value;

const activeStep = (root: ParentNode): string | undefined =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-onboarding-step]")).find(
    (step) => !step.hidden,
  )?.dataset["onboardingStep"];

const mount = () => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const previews: Array<readonly [string, string]> = [];
  const creations: Array<readonly [string, string, string]> = [];
  let renders = 0;
  const wallet = {
    createAccount(mnemonic: string, networkId: string, vaultPassphrase: string) {
      creations.push([mnemonic, networkId, vaultPassphrase]);
      return Promise.resolve();
    },
    generateMnemonic: () => Promise.resolve(MNEMONIC),
    loadStatus: () => Promise.resolve({ ...status, accountCount: 1, hasVault: true }),
    previewAccount(mnemonic: string, networkId: string) {
      previews.push([mnemonic, networkId]);
      return Promise.resolve(account);
    },
  } as unknown as SidepanelWallet;
  bindOnboarding({
    app,
    render: async () => {
      renders += 1;
    },
    wallet,
  });
  return { app, creations, previews, renders: () => renders };
};

describe("staged onboarding", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("imports, previews, explicitly selects, then persists one account", async () => {
    const flow = mount();
    click(flow.app, "#add-existing-button");
    expect(activeStep(flow.app)).toBe("method");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    expect(flow.app.querySelector<HTMLButtonElement>("#recovery-continue")?.disabled).toBe(false);
    click(flow.app, "#recovery-continue");

    expect(activeStep(flow.app)).toBe("password");
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#review-account-button");
    await tick();

    expect(activeStep(flow.app)).toBe("accounts");
    expect(flow.previews).toEqual([[MNEMONIC, "SN_MAIN"]]);
    expect(flow.app.querySelector("#account-preview")?.getAttribute("aria-pressed")).toBe("false");
    expect(flow.app.querySelector<HTMLButtonElement>("#create-wallet-button")?.disabled).toBe(true);

    click(flow.app, "#account-preview");
    const acknowledgement = flow.app.querySelector<HTMLInputElement>('input[name="mainnetAck"]');
    if (!acknowledgement) {
      throw new Error("missing Mainnet acknowledgement");
    }
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(flow.app.querySelector<HTMLButtonElement>("#create-wallet-button")?.disabled).toBe(
      false,
    );
    flow.app.querySelector<HTMLFormElement>("#create-form")?.requestSubmit();
    await tick();

    expect(flow.creations).toEqual([[MNEMONIC, "SN_MAIN", PASSPHRASE]]);
    expect(flow.renders()).toBe(1);
  });

  test("requires revealing and confirming a generated backup before password setup", async () => {
    const flow = mount();
    click(flow.app, "#create-new-button");
    await tick();

    expect(activeStep(flow.app)).toBe("generated");
    expect(
      flow.app.querySelector('[data-recovery-grid="generated"]')?.classList.contains("is-masked"),
    ).toBe(true);
    const generatedGrid = flow.app.querySelector<HTMLElement>('[data-recovery-grid="generated"]');
    expect(generatedGrid?.hasAttribute("inert")).toBe(true);
    expect(generatedGrid?.getAttribute("aria-hidden")).toBe("true");
    expect(
      flow.app.querySelector<HTMLInputElement>(
        'input[data-recovery-kind="generated"]:not([hidden])',
      )?.tabIndex,
    ).toBe(-1);
    expect(flow.app.querySelector<HTMLButtonElement>("#generated-continue")?.disabled).toBe(true);
    click(flow.app, "#phrase-toggle");
    expect(generatedGrid?.hasAttribute("inert")).toBe(false);
    expect(generatedGrid?.hasAttribute("aria-hidden")).toBe(false);
    expect(flow.app.querySelector<HTMLButtonElement>("#generated-continue")?.disabled).toBe(false);
    click(flow.app, "#generated-continue");

    expect(activeStep(flow.app)).toBe("verify");
    setValue(flow.app, 'input[name="verify-0"]', "gamma");
    setValue(flow.app, 'input[name="verify-1"]', "eta");
    setValue(flow.app, 'input[name="verify-2"]', "lambda");
    expect(flow.app.querySelector<HTMLButtonElement>("#verify-continue")?.disabled).toBe(false);
    click(flow.app, "#verify-continue");
    expect(activeStep(flow.app)).toBe("password");
    expect(flow.creations).toEqual([]);
  });

  test("keeps word positions labelled once filled, and cell visibility on the inputs", async () => {
    const flow = mount();
    click(flow.app, "#create-new-button");
    await tick();

    const generated = cellsOf(flow.app, "generated");
    expect(generated.length).toBe(24);
    expect(generated.slice(0, 12).map(wordOf)).toEqual(MNEMONIC.split(" "));
    expect(generated.map(positionOf)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));

    // The toggle drives `hidden` on the inputs only; a cell carrying it could
    // never be revealed again (see recoveryWordInputs).
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    const imported = cellsOf(flow.app, "import");
    const hiddenFlags = () => imported.map((cell) => inputOf(cell).hidden);
    expect(hiddenFlags().filter(Boolean).length).toBe(12);
    click(flow.app, "#phrase-length-toggle");
    expect(hiddenFlags().filter(Boolean).length).toBe(0);
    click(flow.app, "#phrase-length-toggle");
    expect(hiddenFlags().filter(Boolean).length).toBe(12);
    expect(imported.map(positionOf)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(imported.some((cell) => cell.hasAttribute("hidden"))).toBe(false);
  });

  test("keeps the Ledger route distinct and reversible", () => {
    const flow = mount();
    click(flow.app, "#add-existing-button");
    click(flow.app, "#ledger-method-button");
    expect(activeStep(flow.app)).toBe("ledger");
    click(flow.app, '[data-onboarding-step="ledger"] [data-onboarding-back]');
    expect(activeStep(flow.app)).toBe("method");
  });
});
