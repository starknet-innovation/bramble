/**
 * The new-wallet account step presents the sole derived account as the account
 * being created: the row is a read-out, not a choice, and the outcome-named
 * final action enables as soon as the account preview resolves. Explicit
 * selection is preserved only where recovery discovers several accounts (that
 * step is exercised by sidepanel-onboarding-flow.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  AccountContractType,
  AccountRef,
  DerivedAccountRef,
} from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { DEFAULT_BACKUP_VERIFY_POSITIONS } from "../../../../src/sidepanel/journeys/onboarding/backup-verify";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { friendlyAccountName } from "../../../../src/sidepanel/shared/parts";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";
const PASSPHRASE = "fixture vault passphrase";
const WORDS = MNEMONIC.split(" ");
const VERIFY_ANSWERS = DEFAULT_BACKUP_VERIFY_POSITIONS.map((at) => WORDS[at - 1] ?? "");

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

const account: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  classHash: "0x023456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  networkId: "SN_MAIN",
  publicKeyX: "0x123",
  publicKeyY: "0x456",
};
const argentAccount: DerivedAccountRef = {
  ...account,
  accountContractType: "argent",
  deploymentSalt: "0x123",
};

const accountFor = (accountContractType: AccountContractType): AccountRef =>
  accountContractType === "argent" ? argentAccount : account;

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

const activeStep = (root: ParentNode): string | undefined =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-onboarding-step]")).find(
    (step) => !step.hidden,
  )?.dataset["onboardingStep"];

const mount = (
  previewAccount?: (
    mnemonic: string,
    networkId: string,
    accountContractType: AccountContractType,
  ) => Promise<AccountRef>,
): HTMLElement => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const wallet = {
    createAccount: () => Promise.resolve(),
    generateMnemonic: () => Promise.resolve(MNEMONIC),
    loadStatus: () => Promise.resolve({ ...status, accountCount: 1, hasVault: true }),
    previewAccount: (_mnemonic: string, _networkId: string, type: AccountContractType) =>
      previewAccount
        ? previewAccount(_mnemonic, _networkId, type)
        : Promise.resolve(accountFor(type)),
    validateMnemonic: () => Promise.resolve(true),
  } as unknown as SidepanelWallet;
  bindOnboarding({ app, render: async () => undefined, wallet });
  return app;
};

/** Drives the create-new-wallet path up to the account-review step. */
const driveToAccountStep = async (app: HTMLElement): Promise<void> => {
  click(app, "#create-new-button");
  await tick();
  click(app, "#phrase-toggle");
  click(app, "#generated-continue");
  VERIFY_ANSWERS.forEach((answer, index) => {
    setValue(app, `input[name="verify-${index}"]`, answer);
  });
  click(app, "#verify-continue");
  setValue(app, 'input[name="vaultPassphrase"]', PASSPHRASE);
  setValue(app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
  click(app, "#password-continue-button");
  await tick();
};

describe("new-wallet account step", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("presents the sole derived account without a selection click", async () => {
    const app = mount();
    await driveToAccountStep(app);

    expect(activeStep(app)).toBe("accounts");
    // The row states the account being created; it is a read-out, not a control.
    const row = app.querySelector<HTMLElement>("#account-preview");
    expect(row?.tagName).toBe("DIV");
    expect(row?.querySelector("button, a, input, [aria-pressed]")).toBeNull();
    // It carries the name the account will have after setup (the nickname
    // derived from its address), not a fixed label Home never shows.
    const created = accountFor("openzeppelin");
    expect(row?.querySelector("[data-preview-label]")?.textContent).toBe(
      friendlyAccountName(created.address),
    );
    expect(row?.textContent).not.toContain("Primary");
    // The final action is outcome-named and enabled by the preview alone.
    const submit = app.querySelector<HTMLButtonElement>("#create-wallet-button");
    expect(submit?.textContent).toContain("Finish setup");
    expect(submit?.disabled).toBe(false);
  });

  test("keeps the final action gated on a valid preview, not on a click", async () => {
    // A preview that never settles cannot advance the step or open the gate.
    const app = mount(() => new Promise<AccountRef>(() => undefined));
    await driveToAccountStep(app);

    expect(activeStep(app)).not.toBe("accounts");
    expect(app.querySelector<HTMLButtonElement>("#create-wallet-button")?.disabled).toBe(true);
  });
});
