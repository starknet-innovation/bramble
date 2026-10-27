/**
 * "Can't find it? Paste the account address" in the recovery picker (issue
 * 398): the pasted address or link reaches the background lookup bound to the
 * picker's phrase, a match joins the list picked and keeps its address through
 * the restore, and every refusal reads as the reader's next move.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ArgentXAccountRef } from "@bramble/wallet-model/accounts";
import {
  ADDRESS_IMPORT_REFUSALS,
  type RecoveryAccountCandidate,
  type RecoveryAccountSelection,
} from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import { recoveryScanFields } from "../../../../src/sidepanel/journeys/onboarding/onboarding-views";
import { bindRecoveryAccountUi } from "../../../../src/sidepanel/journeys/onboarding/recovery-account-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";
const PASSPHRASE = "fixture vault passphrase";
const PASTED = "0x7e57ad0e55";

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

const readyAt = (index: number): ArgentXAccountRef => ({
  accountContractType: "argent",
  address: PASTED,
  classHash: "0x36078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f",
  deploymentSalt: "0x2a",
  derivation: { addressIndex: index, kind: "argentx-bip44" },
  id: `SN_MAIN:${PASTED}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x2a",
});

const found = (
  restriction?: RecoveryAccountCandidate["restriction"],
): RecoveryAccountCandidate => ({
  account: readyAt(4),
  byAddress: true,
  deployed: true,
  funded: false,
  ...(restriction ? { restriction } : {}),
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setValue = (root: ParentNode, selector: string, value: string): void => {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`missing ${selector}`);
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const click = (root: ParentNode, selector: string): void => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`missing ${selector}`);
  button.click();
};

const resultLine = (root: ParentNode): string =>
  root.querySelector("#recovery-address-result")?.textContent ?? "";

// First-run restore, driven to the picker, with the lookup and restore captured.
const firstRun = (lookup: (address: string) => Promise<RecoveryAccountCandidate>) => {
  const lookups: unknown[][] = [];
  const restored: RecoveryAccountSelection[][] = [];
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const wallet = {
    discoverRecoveryAccounts: () =>
      Promise.resolve({ candidates: [], complete: true, nextIndex: 20, ok: true as const }),
    findRecoveryAccountByAddress: (...args: unknown[]) => {
      lookups.push(args);
      return lookup(args[2] as string);
    },
    loadStatus: () => Promise.resolve(status),
    recoverAccounts: (
      _mnemonic: string,
      _network: string,
      _passphrase: string,
      selections: RecoveryAccountSelection[],
    ) => {
      restored.push(selections);
      return Promise.resolve([readyAt(4)]);
    },
    validateMnemonic: () => Promise.resolve(true),
  } as unknown as SidepanelWallet;
  bindOnboarding({ app, render: async () => undefined, wallet });
  return { app, lookups, restored };
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

const find = async (app: HTMLElement, text: string): Promise<void> => {
  setValue(app, 'input[name="recoveryAddress"]', text);
  click(app, "#recovery-address-search");
  await tick();
  await tick();
};

describe("finding an account by its address in the recovery picker", () => {
  beforeEach(() => document.body.replaceChildren());

  test("offers the finder under the scan, naming the network it searches", async () => {
    const { app } = firstRun(() => Promise.resolve(found()));
    await reachPicker(app);
    expect(app.querySelector("[data-recovery-address] summary")?.textContent).toBe(
      "Can't find it? Paste the account address",
    );
    expect(app.querySelector("[data-recovery-address-network]")?.textContent).toBe(
      "On Starknet Mainnet",
    );
  });

  test("a match joins its group picked, and the restore carries its address", async () => {
    const { app, lookups, restored } = firstRun(() => Promise.resolve(found()));
    await reachPicker(app);
    await find(app, "0x0007E57AD0E55");
    expect(lookups).toEqual([[MNEMONIC, "SN_MAIN", PASTED]]);
    expect(resultLine(app)).toBe("Found Account 4.");
    const group = app.querySelector<HTMLDetailsElement>('[data-recovery-group="argent"]');
    expect(group?.open).toBe(true);
    expect(group?.querySelector<HTMLInputElement>("input.select-check")?.checked).toBe(true);
    click(app, "#recover-accounts-button");
    await tick();
    expect(restored).toEqual([
      [
        {
          accountContractType: "argent",
          accountIndex: 4,
          address: PASTED,
          classHash: readyAt(4).classHash,
          derivation: "argentx-bip44",
        },
      ],
    ]);
  });

  test("an explorer link is read for its address", async () => {
    const { app, lookups } = firstRun(() => Promise.resolve(found()));
    await reachPicker(app);
    await find(app, `https://voyager.online/contract/${PASTED}`);
    expect(lookups).toEqual([[MNEMONIC, "SN_MAIN", PASTED]]);
  });

  test("a link for another network, or something that is not an address, is answered here", async () => {
    const { app, lookups } = firstRun(() => Promise.resolve(found()));
    await reachPicker(app);
    await find(app, `https://sepolia.starkscan.co/contract/${PASTED}`);
    expect(resultLine(app)).toBe("That link is for Starknet Sepolia, not Starknet Mainnet.");
    await find(app, "not an address");
    expect(resultLine(app)).toBe("That doesn't look like a Starknet address.");
    await find(app, `http://starkscan.co/contract/${PASTED}`);
    expect(resultLine(app)).toBe("Use the https:// link from the explorer.");
    expect(lookups).toEqual([]);
  });

  test("a guardian or 2FA account is found view only", async () => {
    const { app } = firstRun(() => Promise.resolve(found("guardian")));
    await reachPicker(app);
    await find(app, PASTED);
    expect(resultLine(app)).toBe("Found Account 4. It's view only until you recover it.");
  });

  test("each refusal reads as the reader's next move", async () => {
    const cases: readonly (readonly [string, string])[] = [
      [
        ADDRESS_IMPORT_REFUSALS.notDeployed,
        "No account found at this address on Starknet Mainnet. Check the address and network.",
      ],
      [ADDRESS_IMPORT_REFUSALS.noMatch, "This recovery phrase doesn't control that account."],
      [
        ADDRESS_IMPORT_REFUSALS.unsupportedClass,
        "Bramble doesn't support this account's contract version yet.",
      ],
      [
        ADDRESS_IMPORT_REFUSALS.nonStarkOwner,
        "This account is controlled by a signer Bramble can't use.",
      ],
      [ADDRESS_IMPORT_REFUSALS.unavailable, "Couldn't check this account. Try again."],
    ];
    for (const [refusal, line] of cases) {
      document.body.replaceChildren();
      const { app } = firstRun(() => Promise.reject(new Error(refusal)));
      await reachPicker(app);
      await find(app, PASTED);
      expect(resultLine(app)).toBe(line);
      expect(
        app.querySelectorAll('[data-recovery-group="argent"] input.select-check'),
      ).toHaveLength(0);
    }
  });

  test("stays busy for the whole lookup, saying it can take a few seconds", async () => {
    let answer: (candidate: RecoveryAccountCandidate) => void = () => undefined;
    const pending = new Promise<RecoveryAccountCandidate>((resolve) => {
      answer = resolve;
    });
    const { app, lookups } = firstRun(() => pending);
    await reachPicker(app);
    await find(app, PASTED);
    const button = app.querySelector<HTMLButtonElement>("#recovery-address-search");
    const input = app.querySelector<HTMLInputElement>('input[name="recoveryAddress"]');
    expect(resultLine(app)).toBe("Checking this account. This can take a few seconds.");
    expect(button?.disabled).toBe(true);
    expect(button?.hasAttribute("data-busy")).toBe(true);
    expect(input?.disabled).toBe(true);
    input?.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    expect(lookups).toHaveLength(1);
    answer(found());
    await tick();
    expect(resultLine(app)).toBe("Found Account 4.");
    expect(button?.disabled).toBe(false);
    expect(input?.disabled).toBe(false);
  });

  test("going back ends a lookup in flight and ignores its late answer", async () => {
    let answer: (candidate: RecoveryAccountCandidate) => void = () => undefined;
    const { app } = firstRun(
      () =>
        new Promise<RecoveryAccountCandidate>((resolve) => {
          answer = resolve;
        }),
    );
    await reachPicker(app);
    await find(app, PASTED);
    click(app, '[data-onboarding-step="recovery-accounts"] [data-onboarding-back]');
    const button = app.querySelector<HTMLButtonElement>("#recovery-address-search");
    expect(resultLine(app)).toBe("");
    expect(button?.disabled).toBe(false);
    answer(found());
    await tick();
    expect(resultLine(app)).toBe("");
    expect(app.querySelectorAll('[data-recovery-group="argent"] input.select-check')).toHaveLength(
      0,
    );
  });

  test("Enter in the field searches without submitting the form", async () => {
    const { app, lookups } = firstRun(() => Promise.resolve(found()));
    await reachPicker(app);
    const input = app.querySelector<HTMLInputElement>('input[name="recoveryAddress"]');
    if (!input) throw new Error("missing address field");
    input.value = PASTED;
    const enter = new window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    input.dispatchEvent(enter);
    await tick();
    expect(enter.defaultPrevented).toBe(true);
    expect(lookups).toHaveLength(1);
  });
});

describe("finding an account by its address against the wallet's own phrase", () => {
  beforeEach(() => document.body.replaceChildren());

  test("uses the injected lookup, and an account already in the wallet stays locked", async () => {
    const form = document.createElement("form");
    form.innerHTML = `${recoveryScanFields()}<button id="recover-accounts-button" type="button"></button>`;
    document.body.append(form);
    const looked: string[] = [];
    const picker = bindRecoveryAccountUi({
      discover: () =>
        Promise.resolve({ candidates: [], complete: true, nextIndex: 20, ok: true as const }),
      existingIds: () => new Set([readyAt(4).id]),
      findByAddress: (address) => {
        looked.push(address);
        return Promise.resolve(found());
      },
      form,
      networkId: () => "SN_MAIN",
      render: async () => undefined,
      restore: () => Promise.resolve([]),
      wallet: {} as SidepanelWallet,
    });
    picker.start();
    await tick();
    await find(form as unknown as HTMLElement, PASTED);
    expect(looked).toEqual([PASTED]);
    expect(resultLine(form)).toBe("Account 4 is already in this wallet.");
    const check = form.querySelector<HTMLInputElement>('[data-recovery-group="argent"] input');
    expect(check?.disabled).toBe(true);
    expect(check?.checked).toBe(false);
  });
});
