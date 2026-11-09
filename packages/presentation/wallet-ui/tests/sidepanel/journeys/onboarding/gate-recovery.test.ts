/**
 * The recovery gate (Sherlock #138): a locked status that carries `recovery`
 * shows why the vault cannot be unlocked normally instead of an unlock that
 * cannot succeed. `unverified` and `rollback` offer "Unlock anyway", which
 * sends `wallet.unlockUnverified`; `invalid` cannot be decrypted, so it offers
 * only reinstalling and restoring from the recovery phrase.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { locked } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindUnlock } from "../../../../src/sidepanel/journeys/onboarding/unlock-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const PASSWORD = "fixture vault password";
const REINSTALL = "reinstall Bramble and restore your wallet from its recovery phrase";
const lockedStatus: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: true,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};
const unlockedStatus: WalletStatus = { ...lockedStatus, accountCount: 0, locked: false };
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const submit = (password: string): void => {
  const input = document.querySelector<HTMLInputElement>('input[name="vaultPassphrase"]');
  if (!input) throw new Error("missing password input");
  input.value = password;
  document.querySelector<HTMLFormElement>("#unlock-form")?.requestSubmit();
};

describe("recovery gate view", () => {
  test("offers Unlock anyway for a vault no record vouches for", () => {
    const html = locked({ ...lockedStatus, recovery: "unverified" });
    expect(html).toContain("Check this wallet");
    expect(html).toContain("cannot confirm this is the latest copy");
    expect(html).toContain('data-unlock="unverified"');
    expect(html).toMatch(/<button type="submit">Unlock anyway<\/button>/);
    expect(html).toContain("Unlocking it disconnects every site.");
    expect(html.toLowerCase()).toContain(REINSTALL.toLowerCase());
    expect(html).not.toContain("Welcome back");
  });

  test("says a newer copy is on record, and why that can happen, for a rollback", () => {
    const html = locked({ ...lockedStatus, recovery: "rollback" });
    expect(html).toContain("This wallet is out of date");
    expect(html).toContain("Restoring a browser backup causes this.");
    expect(html).toContain("someone may have changed this browser's data");
    expect(html).toMatch(/<button type="submit">Unlock anyway<\/button>/);
  });

  test("offers only reinstalling for a vault that cannot be decrypted", () => {
    const html = locked({ ...lockedStatus, recovery: "invalid" });
    expect(html).toContain("This wallet cannot be opened");
    expect(html.toLowerCase()).toContain(REINSTALL.toLowerCase());
    expect(html).not.toContain('id="unlock-form"');
    expect(html).not.toContain("Unlock anyway");
  });

  test("keeps Unlock anyway disabled until the wallet is ready", () => {
    expect(locked({ ...lockedStatus, ready: false, recovery: "unverified" })).toMatch(
      /<button type="submit" disabled>Unlock anyway<\/button>/,
    );
  });
});

describe("recovery gate binding", () => {
  test("sends Unlock anyway, never a normal unlock, and renders the unlocked status", async () => {
    document.body.innerHTML = `<main id="app">${locked({ ...lockedStatus, recovery: "rollback" })}</main>`;
    const sent: string[] = [];
    const rendered: WalletStatus[] = [];
    bindUnlock({
      app: document.querySelector("#app"),
      render: async (next) => void rendered.push(next),
      wallet: {
        unlockUnverifiedVault: async (password: string) => {
          sent.push(`unverified:${password}`);
          return unlockedStatus;
        },
        unlockVault: async (password: string) => {
          sent.push(`normal:${password}`);
          return unlockedStatus;
        },
      } as unknown as SidepanelWallet,
    });

    submit(PASSWORD);
    await tick();

    expect(sent).toEqual([`unverified:${PASSWORD}`]);
    expect(rendered).toEqual([unlockedStatus]);
  });

  test("keeps a normal unlock on the ordinary gate", async () => {
    document.body.innerHTML = `<main id="app">${locked(lockedStatus)}</main>`;
    const sent: string[] = [];
    bindUnlock({
      app: document.querySelector("#app"),
      render: async () => undefined,
      wallet: {
        unlockUnverifiedVault: async () => {
          sent.push("unverified");
          return unlockedStatus;
        },
        unlockVault: async () => {
          sent.push("normal");
          return unlockedStatus;
        },
      } as unknown as SidepanelWallet,
    });

    submit(PASSWORD);
    await tick();

    expect(sent).toEqual(["normal"]);
  });
});
