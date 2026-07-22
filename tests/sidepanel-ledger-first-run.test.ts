/**
 * First-run Ledger onboarding under happy-dom:
 *   - bindLedgerFirstRun gates the "Set up with a Ledger" button on a valid
 *     unlock passphrase (and, on Mainnet, the real-funds acknowledgement) and
 *     hands the captured network + passphrase to its owner;
 *   - createLedgerOnboardEntry drives the shared overlay and branches its create
 *     step: a first-run stash creates a brand-new Ledger vault, while no stash
 *     adds a keyless account to the already-unlocked wallet.
 * The device is an injected fake connector — no WebHID or background.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { onboarding } from "../src/sidepanel/gate-views";
import type { LedgerDeviceClient } from "../src/sidepanel/ledger/client";
import { bindLedgerFirstRun } from "../src/sidepanel/ledger/first-run";
import { createLedgerOnboardEntry } from "../src/sidepanel/ledger/onboard-entry";
import type { LedgerConnector } from "../src/sidepanel/ledger/sign-session";
import { emptyRenderCache } from "../src/sidepanel/render-cache";
import type { SidepanelWallet } from "../src/sidepanel/runtime";
import { ledgerAccountPath } from "../src/starknet/ledger-path";
import type { LedgerAccountRef } from "../src/storage/vault-schema";
import { registerDom, unregisterDom } from "./support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const PASSPHRASE = "correct horse battery staple";

const mainnetStatus: WalletStatus = {
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

const mountOnboarding = (status: WalletStatus) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const captured: Array<readonly [string, string]> = [];
  bindLedgerFirstRun({
    app,
    startLedgerSetup: (networkId, vaultPassphrase) => captured.push([networkId, vaultPassphrase]),
  });
  return { app, captured };
};

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
  button.dispatchEvent(new window.Event("click", { bubbles: true }));
};

// Toggles a picker checkbox and fires the change event the runtime listens for.
const check = (root: ParentNode, selector: string): void => {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`missing ${selector}`);
  }
  input.checked = !input.checked;
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
};

describe("bindLedgerFirstRun", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("gates the button until the passphrase and Mainnet ack are satisfied", () => {
    const { app, captured } = mountOnboarding(mainnetStatus);
    const button = app.querySelector<HTMLButtonElement>("#ledger-setup-button");
    expect(button?.disabled).toBe(true);

    setValue(app, 'input[name="ledgerVaultPassphrase"]', PASSPHRASE);
    // Passphrase alone is not enough on Mainnet — the ack must be checked too.
    expect(button?.disabled).toBe(true);

    const ack = app.querySelector<HTMLInputElement>('input[name="ledgerMainnetAck"]');
    if (ack) {
      ack.checked = true;
      ack.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
    expect(button?.disabled).toBe(false);

    click(app, "#ledger-setup-button");
    expect(captured).toEqual([["SN_MAIN", PASSPHRASE]]);
  });

  test("shows a passphrase hint for a too-short passphrase", () => {
    const { app } = mountOnboarding(mainnetStatus);
    setValue(app, 'input[name="ledgerVaultPassphrase"]', "short");
    expect(app.querySelector("#ledger-passphrase-result")?.textContent).toContain(
      "at least 12 characters",
    );
  });

  test("does not require an ack off Mainnet and starts setup on a valid passphrase", () => {
    const { app, captured } = mountOnboarding({ ...mainnetStatus, networkId: "SN_MAIN" });
    const networkSelect = app.querySelector<HTMLSelectElement>('select[name="ledgerNetworkId"]');
    if (networkSelect) {
      networkSelect.value = "SN_SEPOLIA";
      networkSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
    setValue(app, 'input[name="ledgerVaultPassphrase"]', PASSPHRASE);
    click(app, "#ledger-setup-button");
    expect(captured).toEqual([["SN_SEPOLIA", PASSPHRASE]]);
  });

  test("blocks setup and toasts when the Mainnet ack is missing at click time", () => {
    const { app, captured } = mountOnboarding(mainnetStatus);
    setValue(app, 'input[name="ledgerVaultPassphrase"]', PASSPHRASE);
    // Valid passphrase but the Mainnet ack is unchecked: clicking must not start.
    click(app, "#ledger-setup-button");
    expect(captured).toEqual([]);
    expect(document.querySelector(".toast.error")?.textContent).toContain("real-funds");
  });

  test("blocks setup and toasts when the passphrase is too short at click time", () => {
    const { app, captured } = mountOnboarding({
      ...mainnetStatus,
      networkId: "SN_SEPOLIA",
      network: "Starknet Sepolia",
    });
    // Off Mainnet, no ack needed; click with an empty passphrase must not start.
    click(app, "#ledger-setup-button");
    expect(captured).toEqual([]);
    expect(document.querySelector(".toast.error")?.textContent).toContain("at least 12 characters");
  });
});

const enumerateClient: LedgerDeviceClient = {
  getAppVersion: () =>
    Promise.resolve({
      errorMessage: "No errors",
      major: 2,
      minor: 0,
      patch: 0,
      returnCode: 0x9000,
    }),
  getPubKey: () =>
    Promise.resolve({
      errorMessage: "No errors",
      publicKey: new Uint8Array([4, ...new Array(31).fill(0), 7, ...new Array(32).fill(0)]),
      returnCode: 0x9000,
    }),
  signHash: () => Promise.reject(new Error("unused")),
};

const candidate = (index: number): LedgerAccountRef => ({
  address: `0x${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: {
    accountIndex: index,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(index),
  },
  id: `SN_MAIN:0x${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`,
  networkId: "SN_MAIN",
  publicKeyX: `0x${index + 1}`,
});

const entryHarness = () => {
  document.body.replaceChildren();
  const mount = document.createElement("div");
  mount.hidden = true;
  document.body.append(mount);
  const cache = emptyRenderCache();
  const created: Array<readonly [string, number, string, string]> = [];
  const added: Array<readonly [string, number, string]> = [];
  const connector: LedgerConnector = {
    openConnected: () => Promise.resolve(null),
    request: () => Promise.resolve({ client: enumerateClient, close: () => Promise.resolve() }),
  };
  const wallet = {
    addLedgerAccount: (networkId: string, accountIndex: number, publicKeyX: string) => {
      added.push([networkId, accountIndex, publicKeyX]);
      return Promise.resolve(candidate(accountIndex).id);
    },
    createLedgerVault: (
      networkId: string,
      accountIndex: number,
      publicKeyX: string,
      vaultPassphrase: string,
    ) => {
      created.push([networkId, accountIndex, publicKeyX, vaultPassphrase]);
      return Promise.resolve(candidate(accountIndex).id);
    },
    deriveLedgerAccounts: () => Promise.resolve([candidate(0), candidate(1)]),
    ledgerAccountStatus: () => Promise.resolve({ balance: null, deployed: null }),
    loadStatus: () => Promise.resolve(mainnetStatus),
  } as unknown as SidepanelWallet;
  let refreshed = 0;
  const entry = createLedgerOnboardEntry({
    addHd: () => Promise.resolve(),
    cache,
    connector,
    mount,
    openImport: () => undefined,
    refresh: () => {
      refreshed += 1;
      return Promise.resolve();
    },
    wallet,
  });
  return { added, created, entry, mount, refreshed: () => refreshed };
};

describe("createLedgerOnboardEntry", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("first-run setup creates a brand-new Ledger vault with the passphrase", async () => {
    const h = entryHarness();
    h.entry.startLedgerSetup("SN_MAIN", PASSPHRASE);
    expect(h.mount.hidden).toBe(false);

    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();
    check(h.mount, '[data-ledger-toggle="1"]');
    click(h.mount, "[data-ledger-add-selected]");
    await tick();

    expect(h.created).toEqual([["SN_MAIN", 1, candidate(1).publicKeyX, PASSPHRASE]]);
    expect(h.added).toEqual([]);
    expect(h.refreshed()).toBe(1);
  });

  test("the add-to-existing trigger adds a keyless account without a passphrase", async () => {
    const h = entryHarness();
    const app = document.createElement("div");
    const trigger = document.createElement("button");
    trigger.setAttribute("data-connect-ledger", "");
    app.append(trigger);
    document.body.append(app);
    h.entry.bindTriggers(app);

    click(app, "[data-connect-ledger]");
    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();
    check(h.mount, '[data-ledger-toggle="0"]');
    click(h.mount, "[data-ledger-add-selected]");
    await tick();

    expect(h.added).toEqual([["SN_MAIN", 0, candidate(0).publicKeyX]]);
    expect(h.created).toEqual([]);
  });

  test("cancelling first-run setup clears the captured passphrase from the stash", async () => {
    const h = entryHarness();
    h.entry.startLedgerSetup("SN_MAIN", PASSPHRASE);
    expect(h.mount.hidden).toBe(false);

    // Dismiss the overlay from the connect stage via the rendered cancel control.
    click(h.mount, "[data-ledger-onboard-cancel]");
    expect(h.mount.hidden).toBe(true);

    // Prove the stash was cleared: re-entering through the add-account trigger now
    // ADDS a keyless account rather than creating a vault — createLedgerVault is
    // never called again, so the dismissed passphrase is not reused or retained.
    const app = document.createElement("div");
    const trigger = document.createElement("button");
    trigger.setAttribute("data-connect-ledger", "");
    app.append(trigger);
    document.body.append(app);
    h.entry.bindTriggers(app);

    click(app, "[data-connect-ledger]");
    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();
    check(h.mount, '[data-ledger-toggle="0"]');
    click(h.mount, "[data-ledger-add-selected]");
    await tick();

    expect(h.created).toEqual([]);
    expect(h.added).toEqual([["SN_MAIN", 0, candidate(0).publicKeyX]]);
  });
});
