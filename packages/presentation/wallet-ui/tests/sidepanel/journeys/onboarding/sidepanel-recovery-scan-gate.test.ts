/**
 * Recovery-scan gate: Bramble creates only Bramble accounts, so a Ready
 * candidate with no on-chain history — which would be a brand-new Ready
 * deployment — is listed for transparency but never selectable. Deployed or
 * funded (counterfactual) Ready accounts stay importable, and Bramble
 * candidates are unaffected.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BRAAVOS_BASE_CLASS_HASH, deploymentClasses } from "@bramble/wallet-model/account-families";
import { ARGENT_ACCOUNT_CLASS_HASH, type DerivedAccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";
const PASSPHRASE = "fixture vault passphrase";

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const brambleAccount: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: "0xabc",
  classHash: "0x1",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0xabc",
  networkId: "SN_MAIN",
  publicKeyX: "0x2",
  publicKeyY: "0x3",
};

const readyIdleAccount: DerivedAccountRef = {
  ...brambleAccount,
  accountContractType: "argent",
  address: "0xready0",
  id: "SN_MAIN:0xready0",
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setValue = (root: ParentNode, selector: string, value: string): void => {
  const input = root.querySelector<HTMLInputElement>(selector);
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

type Candidate = { account: DerivedAccountRef; deployed: boolean; funded: boolean };

const mount = (
  candidates: readonly Candidate[] = [
    { account: brambleAccount, deployed: true, funded: false },
    { account: readyIdleAccount, deployed: false, funded: false },
  ],
) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const wallet = {
    discoverRecoveryAccounts: () =>
      Promise.resolve({
        candidates,
        complete: true,
        nextIndex: 20,
        ok: true as const,
      }),
    loadStatus: () => Promise.resolve(status),
    validateMnemonic: () => Promise.resolve(true),
  } as unknown as SidepanelWallet;
  bindOnboarding({ app, render: async () => undefined, wallet });
  return app;
};

const reachPicker = async (app: HTMLElement): Promise<void> => {
  click(app, "#add-existing-button");
  click(app, "#recovery-method-button");
  setValue(app, 'input[name="import-word-0"]', MNEMONIC);
  click(app, "#recovery-continue");
  await tick();
  setValue(app, 'input[name="vaultPassphrase"]', PASSPHRASE);
  setValue(app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
  click(app, "#password-continue-button");
  await tick();
};

const rowsIn =
  (app: HTMLElement) =>
  (contractType: string): readonly HTMLLIElement[] =>
    Array.from(app.querySelectorAll<HTMLLIElement>(`[data-recovery-group="${contractType}"] li`));

describe("recovery scan Ready gate", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("lists an inactive Ready candidate but refuses to select it", async () => {
    const app = mount();
    await reachPicker(app);

    const groupRows = rowsIn(app);
    expect(groupRows("openzeppelin").length).toBe(1);
    expect(groupRows("argent").length).toBe(1);

    const readyGroup = app.querySelector<HTMLDetailsElement>('[data-recovery-group="argent"]');
    const readyCheckbox =
      groupRows("argent")[0]?.querySelector<HTMLInputElement>("input.select-check");
    expect(readyCheckbox?.disabled).toBe(true);
    expect(readyCheckbox?.checked).toBe(false);
    expect(groupRows("argent")[0]?.textContent).toContain(
      "Bramble only imports existing Ready accounts",
    );
    // No active Ready accounts: no detected count, and the group stays closed.
    expect(readyGroup?.textContent).not.toContain("detected");
    expect(readyGroup?.open).toBe(false);

    // The Bramble candidate stays selectable (auto-selected: deployed), its
    // group reports the detection and opens itself.
    const brambleGroup = app.querySelector<HTMLDetailsElement>(
      '[data-recovery-group="openzeppelin"]',
    );
    const brambleCheckbox =
      groupRows("openzeppelin")[0]?.querySelector<HTMLInputElement>("input.select-check");
    expect(brambleCheckbox?.disabled).toBe(false);
    expect(brambleCheckbox?.checked).toBe(true);
    expect(brambleGroup?.textContent).toContain("1 account detected");
    expect(brambleGroup?.open).toBe(true);
  });

  test("shows a found Braavos account, selected, and says it is view only", async () => {
    // Discovery auto-selects every account with activity. A family with no
    // group of its own was selected without ever being shown, so the user
    // restored accounts they never saw.
    const braavos: DerivedAccountRef = {
      ...brambleAccount,
      accountContractType: "braavos",
      address: "0xb4a",
      classHash: BRAAVOS_BASE_CLASS_HASH,
      deploymentSalt: "0x2",
      id: "SN_MAIN:0xb4a",
    };
    const app = mount([{ account: braavos, deployed: true, funded: false }]);
    await reachPicker(app);

    const [row] = rowsIn(app)("braavos");
    const checkbox = row?.querySelector<HTMLInputElement>("input.select-check");
    expect(rowsIn(app)("braavos").length).toBe(1);
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(false);
    expect(row?.textContent).toContain("view only for now");
    expect(app.querySelector<HTMLDetailsElement>('[data-recovery-group="braavos"]')?.open).toBe(
      true,
    );
  });

  test("names the Argent release on rows that share an index", async () => {
    const earlier = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.0");
    if (!earlier) throw new Error("argent 0.3.0 missing from the class table");
    const current: DerivedAccountRef = {
      ...brambleAccount,
      accountContractType: "argent",
      address: "0xa04",
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      deploymentSalt: "0x2",
      id: "SN_MAIN:0xa04",
    };
    const upgraded: DerivedAccountRef = {
      ...current,
      address: "0xa03",
      classHash: earlier.classHash,
      id: "SN_MAIN:0xa03",
    };
    const app = mount([
      { account: current, deployed: true, funded: false },
      { account: upgraded, deployed: true, funded: false },
    ]);
    await reachPicker(app);

    const titles = rowsIn(app)("argent").map((row) => row.querySelector("strong")?.textContent);
    expect(titles.sort()).toEqual(["Account 0", "Account 0 · Argent 0.3.0"]);
    // Both are selected: they are two accounts, not one listed twice.
    const checked = rowsIn(app)("argent").filter(
      (row) => row.querySelector<HTMLInputElement>("input.select-check")?.checked,
    );
    expect(checked.length).toBe(2);
  });
});
