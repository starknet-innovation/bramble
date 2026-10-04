/** Locked-vault interaction checks kept separate from account onboarding. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { locked } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import {
  bindUnlock,
  bindVaultReset,
} from "../../../../src/sidepanel/journeys/onboarding/unlock-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const PASSPHRASE = "fixture vault passphrase";
const unlockedStatus: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
};
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const setPassphrase = (value: string): void => {
  const input = document.querySelector<HTMLInputElement>('input[name="vaultPassphrase"]');
  if (!input) throw new Error("missing passphrase input");
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

describe("locked vault handoff", () => {
  test("forwards the passphrase and renders the unlocked status", async () => {
    document.body.innerHTML = `<main id="app">${locked({ ...unlockedStatus, locked: true })}</main>`;
    const passphrases: string[] = [];
    const rendered: WalletStatus[] = [];
    bindUnlock({
      app: document.querySelector("#app"),
      render: async (next) => void rendered.push(next),
      wallet: {
        unlockVault: async (vaultPassphrase: string) => {
          passphrases.push(vaultPassphrase);
          return unlockedStatus;
        },
      } as unknown as SidepanelWallet,
    });

    setPassphrase(PASSPHRASE);
    document.querySelector<HTMLFormElement>("#unlock-form")?.requestSubmit();
    await tick();
    expect(passphrases).toEqual([PASSPHRASE]);
    expect(rendered).toEqual([unlockedStatus]);
  });

  test("restores the form and reports a rejected unlock", async () => {
    document.body.innerHTML = `<main id="app">${locked({ ...unlockedStatus, locked: true })}</main>`;
    bindUnlock({
      app: document.querySelector("#app"),
      render: async () => undefined,
      wallet: {
        unlockVault: async () => {
          throw new Error("Incorrect passphrase");
        },
      } as unknown as SidepanelWallet,
    });

    setPassphrase("wrong passphrase");
    document.querySelector<HTMLFormElement>("#unlock-form")?.requestSubmit();
    await tick();
    // The background still throws "Incorrect passphrase"; the status line
    // shows what a reader is told.
    expect(document.querySelector("#form-result")?.textContent).toBe("That passphrase is wrong.");
    expect(
      document.querySelector<HTMLButtonElement>('#unlock-form button[type="submit"]')?.disabled,
    ).toBe(false);
  });

  test("reinitialize archives the vault and renders the vault-less status", async () => {
    document.body.innerHTML = `<main id="app">${locked({ ...unlockedStatus, locked: true })}</main>`;
    const calls: string[] = [];
    const rendered: WalletStatus[] = [];
    const fresh: WalletStatus = {
      ...unlockedStatus,
      accountCount: 0,
      hasVault: false,
      locked: false,
    };
    bindVaultReset({
      app: document.querySelector("#app"),
      render: async (next) => void rendered.push(next),
      wallet: {
        loadStatus: async () => fresh,
        resetVault: async () => {
          calls.push("reset");
        },
      } as unknown as SidepanelWallet,
    });

    document.querySelector<HTMLButtonElement>(".gate-more-panel button")?.click();
    await tick();

    // One click is the confirmation; the consequence lives in the copy.
    expect(calls).toEqual(["reset"]);
    // The vault-less status is what lands the reader on first-run onboarding.
    expect(rendered).toEqual([fresh]);
  });

  test("keeps the reader on unlock when reinitialize fails", async () => {
    document.body.innerHTML = `<main id="app">${locked({ ...unlockedStatus, locked: true })}</main>`;
    bindVaultReset({
      app: document.querySelector("#app"),
      render: async () => undefined,
      wallet: {
        resetVault: async () => {
          throw new Error("wallet reset incomplete");
        },
      } as unknown as SidepanelWallet,
    });
    const button = document.querySelector<HTMLButtonElement>(".gate-more-panel button");

    button?.click();
    await tick();

    expect(document.querySelector("#reset-result")?.textContent).not.toBe("");
    expect(button?.disabled).toBe(false);
  });
});
