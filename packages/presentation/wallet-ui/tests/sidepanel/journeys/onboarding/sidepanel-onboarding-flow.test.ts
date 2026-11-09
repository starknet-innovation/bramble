/**
 * Staged onboarding interaction checks. The runtime is a fixture-only boundary:
 * generated/imported words enter preview first, account selection is explicit,
 * and persistence happens only once a derived account is selected.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  AccountContractType,
  AccountRef,
  DerivedAccountRef,
} from "@bramble/wallet-model/accounts";
import type { RecoveryAccountSelection } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { DEFAULT_BACKUP_VERIFY_POSITIONS } from "../../../../src/sidepanel/journeys/onboarding/backup-verify";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";
const PASSPHRASE = "fixture vault passphrase";
// Bound without a clock, so the confirmation asks the default positions.
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
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
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

const mount = (options?: {
  readonly discoverRecoveryAccounts?: SidepanelWallet["discoverRecoveryAccounts"];
  readonly generateMnemonic?: () => Promise<string>;
  readonly previewAccount?: (
    mnemonic: string,
    networkId: string,
    accountContractType: AccountContractType,
  ) => Promise<AccountRef>;
  readonly validateMnemonic?: (mnemonic: string) => Promise<boolean>;
}) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const previews: Array<readonly [string, string, AccountContractType]> = [];
  const creations: Array<readonly [string, string, string, AccountContractType]> = [];
  const recoveries: Array<readonly RecoveryAccountSelection[]> = [];
  const validations: string[] = [];
  let renders = 0;
  const wallet = {
    createAccount(
      mnemonic: string,
      networkId: string,
      vaultPassphrase: string,
      accountContractType: AccountContractType,
    ) {
      creations.push([mnemonic, networkId, vaultPassphrase, accountContractType]);
      return Promise.resolve();
    },
    generateMnemonic: () => options?.generateMnemonic?.() ?? Promise.resolve(MNEMONIC),
    discoverRecoveryAccounts: (...args: Parameters<SidepanelWallet["discoverRecoveryAccounts"]>) =>
      options?.discoverRecoveryAccounts?.(...args) ??
      Promise.resolve({
        candidates: [{ account, deployed: true, funded: false }],
        complete: true,
        nextIndex: 20,
        ok: true as const,
      }),
    loadStatus: () => Promise.resolve({ ...status, accountCount: 1, hasVault: true }),
    previewAccount(mnemonic: string, networkId: string, accountContractType: AccountContractType) {
      previews.push([mnemonic, networkId, accountContractType]);
      return (
        options?.previewAccount?.(mnemonic, networkId, accountContractType) ??
        Promise.resolve(accountFor(accountContractType))
      );
    },
    recoverAccounts(
      _mnemonic: string,
      _networkId: string,
      _vaultPassphrase: string,
      selections: readonly RecoveryAccountSelection[],
    ) {
      recoveries.push(selections);
      return Promise.resolve([account]);
    },
    validateMnemonic(mnemonic: string) {
      validations.push(mnemonic);
      return options?.validateMnemonic?.(mnemonic) ?? Promise.resolve(true);
    },
  } as unknown as SidepanelWallet;
  bindOnboarding({
    app,
    render: async () => {
      renders += 1;
    },
    wallet,
  });
  return { app, creations, previews, recoveries, renders: () => renders, validations };
};

describe("staged onboarding", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("restores an explicitly selected account when discovery pauses", async () => {
    let discoveryCalls = 0;
    const flow = mount({
      discoverRecoveryAccounts: () => {
        discoveryCalls += 1;
        if (discoveryCalls > 1) return Promise.reject(new Error("offline"));
        return Promise.resolve({
          candidates: [{ account, deployed: true, funded: false }],
          complete: false,
          nextIndex: 1,
          ok: true as const,
        });
      },
    });
    click(flow.app, "#add-existing-button");
    expect(activeStep(flow.app)).toBe("method");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    expect(flow.app.querySelector<HTMLButtonElement>("#recovery-continue")?.disabled).toBe(false);
    click(flow.app, "#recovery-continue");
    await tick();

    expect(flow.validations).toEqual([MNEMONIC]);
    expect(activeStep(flow.app)).toBe("password");
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#password-continue-button");
    expect(activeStep(flow.app)).toBe("recovery-accounts");
    await tick();

    // The real-funds tickbox was removed in the copy review, so the auto-selected
    // candidate is the only thing standing between the scan and the restore.
    expect(flow.app.querySelector('input[name="recoveryMainnetAck"]')).toBeNull();
    expect(flow.app.querySelector<HTMLButtonElement>("#recover-accounts-button")?.disabled).toBe(
      false,
    );
    click(flow.app, "#recover-accounts-button");
    await tick();

    expect(flow.recoveries).toEqual([[{ accountContractType: "openzeppelin", accountIndex: 0 }]]);
    expect(flow.creations).toEqual([]);
    expect(flow.renders()).toBe(1);
  });

  test("stops automatic account discovery after leaving the recovery picker", async () => {
    let calls = 0;
    let release:
      | ((result: Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>) => void)
      | undefined;
    const flow = mount({
      discoverRecoveryAccounts: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    click(flow.app, "#recovery-continue");
    await tick();
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#password-continue-button");
    expect(calls).toBe(1);

    click(flow.app, '[data-onboarding-step="recovery-accounts"] [data-onboarding-back]');
    release?.({ candidates: [], complete: false, nextIndex: 4, ok: true });
    await tick();

    expect(activeStep(flow.app)).toBe("password");
    expect(calls).toBe(1);
  });

  test("discards a delayed preview invalidated by going back", async () => {
    const releases: ((value: AccountRef) => void)[] = [];
    const flow = mount({
      previewAccount: () =>
        new Promise<AccountRef>((resolve) => {
          releases.push(resolve);
        }),
    });
    click(flow.app, "#create-new-button");
    await tick();
    click(flow.app, "#phrase-toggle");
    click(flow.app, "#generated-continue");
    VERIFY_ANSWERS.forEach((answer, index) => {
      setValue(flow.app, `input[name="verify-${index}"]`, answer);
    });
    click(flow.app, "#verify-continue");
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#password-continue-button");
    expect(releases.length).toBe(1);

    // Going back invalidates the pending review; its late arrival must not
    // advance the flow or enable creation.
    click(flow.app, '[data-onboarding-step="password"] [data-onboarding-back]');
    releases[0]?.(accountFor("openzeppelin"));
    await tick();
    expect(activeStep(flow.app)).not.toBe("accounts");
    expect(flow.app.querySelector<HTMLButtonElement>("#create-wallet-button")?.disabled).toBe(true);

    // A fresh review still lands.
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#password-continue-button");
    releases[1]?.(accountFor("openzeppelin"));
    await tick();
    expect(activeStep(flow.app)).toBe("accounts");
    expect(flow.previews).toEqual([
      [MNEMONIC, "SN_MAIN", "openzeppelin"],
      [MNEMONIC, "SN_MAIN", "openzeppelin"],
    ]);
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
    VERIFY_ANSWERS.forEach((answer, index) => {
      setValue(flow.app, `input[name="verify-${index}"]`, answer);
    });
    expect(flow.app.querySelector<HTMLButtonElement>("#verify-continue")?.disabled).toBe(false);
    click(flow.app, "#verify-continue");
    expect(activeStep(flow.app)).toBe("password");
    expect(flow.creations).toEqual([]);
  });

  test("discards a generated phrase after the user chooses an import route", async () => {
    let release: ((mnemonic: string) => void) | undefined;
    const flow = mount({
      generateMnemonic: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    click(flow.app, "#create-new-button");
    click(flow.app, "#add-existing-button");
    expect(activeStep(flow.app)).toBe("method");
    release?.(MNEMONIC);
    await tick();

    expect(activeStep(flow.app)).toBe("method");
    click(flow.app, '[data-onboarding-step="method"] [data-onboarding-back]');
    expect(activeStep(flow.app)).toBe("welcome");
    expect(flow.app.querySelector<HTMLButtonElement>("#create-new-button")?.disabled).toBe(false);
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

  test("keeps BIP39 membership advisory without blocking Continue", async () => {
    const flow = mount({ validateMnemonic: async () => false });
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    const words = MNEMONIC.split(" ");
    words[0] = "notaword";
    const phrase = words.join(" ");
    setValue(flow.app, 'input[name="import-word-0"]', phrase);
    expect(flow.app.querySelector<HTMLButtonElement>("#recovery-continue")?.disabled).toBe(false);
    expect(
      flow.app.querySelector('input[name="import-word-0"]')?.classList.contains("is-invalid"),
    ).toBe(true);
    expect(flow.app.querySelector("#recovery-result")?.textContent).toBe(
      "Highlighted words are not in the BIP39 English list.",
    );
    click(flow.app, "#recovery-continue");
    await tick();
    expect(flow.validations).toEqual([phrase]);
    expect(activeStep(flow.app)).toBe("recovery");
  });

  test("discards a stale validation after the phrase changes", async () => {
    let release: ((valid: boolean) => void) | undefined;
    const flow = mount({
      validateMnemonic: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    click(flow.app, "#recovery-continue");
    const edited = MNEMONIC.replace("habit", "hope");
    setValue(flow.app, 'input[name="import-word-0"]', edited);
    release?.(true);
    await tick();
    expect(activeStep(flow.app)).toBe("recovery");
    expect(flow.validations).toEqual([MNEMONIC]);
  });

  test("discards a stale validation after the phrase length changes", async () => {
    let release: ((valid: boolean) => void) | undefined;
    const flow = mount({
      validateMnemonic: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    click(flow.app, "#recovery-continue");
    click(flow.app, "#phrase-length-toggle");
    release?.(true);
    await tick();
    expect(activeStep(flow.app)).toBe("recovery");
    expect(flow.app.querySelector<HTMLButtonElement>("#recovery-continue")?.disabled).toBe(true);
    expect(flow.validations).toEqual([MNEMONIC]);
  });

  test("discards a stale validation after leaving and re-entering recovery", async () => {
    let release: ((valid: boolean) => void) | undefined;
    const flow = mount({
      validateMnemonic: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    click(flow.app, "#recovery-continue");
    click(flow.app, '[data-onboarding-step="recovery"] [data-onboarding-back]');
    expect(activeStep(flow.app)).toBe("method");
    click(flow.app, "#recovery-method-button");
    expect(activeStep(flow.app)).toBe("recovery");
    release?.(true);
    await tick();
    expect(activeStep(flow.app)).toBe("recovery");
    expect(flow.validations).toEqual([MNEMONIC]);
  });

  test("normalizes capitalized recovery words before Krusty validation", async () => {
    const flow = mount();
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    const capitalized = MNEMONIC.split(" ")
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" ");
    setValue(flow.app, 'input[name="import-word-0"]', capitalized);
    expect(
      flow.app.querySelector('input[name="import-word-0"]')?.getAttribute("autocapitalize"),
    ).toBe("off");
    click(flow.app, "#recovery-continue");
    await tick();
    expect(flow.validations).toEqual([MNEMONIC]);
    expect(activeStep(flow.app)).toBe("password");
    expect(document.querySelector(".toast.success")?.textContent).toBe("Valid recovery phrase");
  });

  test("keeps an invalid checksum phrase on the recovery step", async () => {
    const flow = mount({ validateMnemonic: async () => false });
    click(flow.app, "#add-existing-button");
    click(flow.app, "#recovery-method-button");
    setValue(flow.app, 'input[name="import-word-0"]', MNEMONIC);
    click(flow.app, "#recovery-continue");
    await tick();
    expect(activeStep(flow.app)).toBe("recovery");
    expect(flow.app.querySelector("#recovery-result")?.textContent).toBe(
      "This recovery phrase is not valid.",
    );
    expect(flow.validations).toEqual([MNEMONIC]);
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
