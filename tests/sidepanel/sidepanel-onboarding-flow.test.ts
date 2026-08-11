/**
 * Staged onboarding interaction checks. The runtime is a fixture-only boundary:
 * generated/imported words enter preview first, account selection is explicit,
 * and persistence happens only after the final Mainnet acknowledgement.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SeedScanCandidate, WalletStatus } from "../../src/popup/responses";
import { onboarding } from "../../src/sidepanel/gate-views";
import { bindOnboarding } from "../../src/sidepanel/onboarding-ui";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import type { AccountRef } from "../../src/storage/vault-schema";
import { registerDom, unregisterDom } from "../support/groups-harness";

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

const activeStep = (root: ParentNode): string | undefined =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-onboarding-step]")).find(
    (step) => !step.hidden,
  )?.dataset["onboardingStep"];

const mount = (discovered: readonly SeedScanCandidate[] = []) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const previews: Array<readonly [string, string]> = [];
  const creations: Array<readonly [string, string, string, number | undefined]> = [];
  const scans: (string | undefined)[] = [];
  const addedIndexes: (number | undefined)[] = [];
  let renders = 0;
  const wallet = {
    addAccount(_networkId: string, accountIndex?: number) {
      addedIndexes.push(accountIndex);
      return Promise.resolve("SN_MAIN:0xadded");
    },
    createAccount(
      mnemonic: string,
      networkId: string,
      vaultPassphrase: string,
      accountIndex?: number,
    ) {
      creations.push([mnemonic, networkId, vaultPassphrase, accountIndex]);
      return Promise.resolve();
    },
    generateMnemonic: () => Promise.resolve(MNEMONIC),
    loadStatus: () => Promise.resolve({ ...status, accountCount: 1, hasVault: true }),
    previewAccount(mnemonic: string, networkId: string) {
      previews.push([mnemonic, networkId]);
      return Promise.resolve(account);
    },
    scanSeedAccounts(mnemonic?: string) {
      scans.push(mnemonic);
      return Promise.resolve(discovered);
    },
  } as unknown as SidepanelWallet;
  bindOnboarding({
    app,
    render: async () => {
      renders += 1;
    },
    wallet,
  });
  return { addedIndexes, app, creations, previews, renders: () => renders, scans };
};

describe("staged onboarding", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("imports, previews, then persists the preselected account", async () => {
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
    // Preselected, like every other row on this screen: each one is an account the
    // phrase has, so the user unselects rather than opting in. The Mainnet
    // acknowledgement remains the explicit consent this screen requires.
    expect(flow.app.querySelector("#account-preview")?.getAttribute("aria-pressed")).toBe("true");
    expect(flow.app.querySelector<HTMLButtonElement>("#create-wallet-button")?.disabled).toBe(true);

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

    // The vault starts at the selected position, which for the primary-only case
    // is index 0.
    expect(flow.creations).toEqual([[MNEMONIC, "SN_MAIN", PASSPHRASE, 0]]);
    expect(flow.addedIndexes).toEqual([]);
    // A typed phrase is scanned so its other accounts can be offered; a generated
    // one is not, having nothing on chain by definition.
    expect(flow.scans).toEqual([MNEMONIC]);
    expect(flow.renders()).toBe(1);
  });

  // The reported bug: recovery listed one account, then added every account the
  // phrase had. The list must show them all, and only what is selected may be
  // added.
  test("lists a phrase's other accounts and adds only the selected ones", async () => {
    const flow = mount([
      { accountIndex: 0, address: "0xa0", alreadyAdded: false, deployed: true, funded: false },
      { accountIndex: 3, address: "0xa3", alreadyAdded: false, deployed: true, funded: false },
      { accountIndex: 7, address: "0xa7", alreadyAdded: false, deployed: false, funded: true },
    ]);
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    click(flow.app, "#recovery-continue");
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#review-account-button");
    await tick();

    // Index 0 is the "Account 1" row, so only 3 and 7 are listed here —
    // listing 0 twice would let one tap select two accounts.
    const rows = Array.from(
      flow.app.querySelectorAll<HTMLButtonElement>("[data-discovered-index]"),
    );
    expect(rows.map((row) => row.dataset["discoveredIndex"])).toEqual(["3", "7"]);
    // Preselected: every candidate has on-chain evidence, so the common case is
    // wanting them.
    expect(rows.map((row) => row.getAttribute("aria-pressed"))).toEqual(["true", "true"]);

    // Account 1 comes preselected too, so unselect it along with account 7: the
    // wallet must come back holding account 3 alone.
    expect(flow.app.querySelector("#account-preview")?.getAttribute("aria-pressed")).toBe("true");
    click(flow.app, "#account-preview");
    click(flow.app, '[data-discovered-index="7"]');
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

    // The vault starts at the lowest selected position — 3, not 0.
    expect(flow.creations).toEqual([[MNEMONIC, "SN_MAIN", PASSPHRASE, 3]]);
    expect(flow.addedIndexes).toEqual([]);
  });

  test("Account 1 can be unselected on its own", async () => {
    const flow = mount();
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    click(flow.app, "#recovery-continue");
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#review-account-button");
    await tick();

    // With nothing else found, unselecting the only account leaves nothing to
    // create, so the submit must close rather than silently pick one.
    click(flow.app, "#account-preview");
    const acknowledgement = flow.app.querySelector<HTMLInputElement>('input[name="mainnetAck"]');
    if (!acknowledgement) {
      throw new Error("missing Mainnet acknowledgement");
    }
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(flow.app.querySelector<HTMLButtonElement>("#create-wallet-button")?.disabled).toBe(true);
    expect(flow.creations).toEqual([]);
  });

  test("a generated phrase is never scanned", async () => {
    const flow = mount();
    click(flow.app, "#create-new-button");
    await tick();

    expect(flow.scans).toEqual([]);
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

  test("keeps the Ledger route distinct and reversible", () => {
    const flow = mount();
    click(flow.app, "#add-existing-button");
    click(flow.app, "#ledger-method-button");
    expect(activeStep(flow.app)).toBe("ledger");
    click(flow.app, '[data-onboarding-step="ledger"] [data-onboarding-back]');
    expect(activeStep(flow.app)).toBe("method");
  });
});
