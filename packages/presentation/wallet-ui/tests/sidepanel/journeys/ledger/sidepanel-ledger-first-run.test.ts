/**
 * First-run Ledger onboarding under happy-dom:
 *   - bindLedgerFirstRun gates the "Set up with a Ledger" button on a valid
 *     unlock passphrase and hands the captured network + passphrase to its
 *     owner;
 *   - createLedgerOnboardEntry drives the shared overlay and branches its create
 *     step: a first-run stash creates a brand-new Ledger vault, while no stash
 *     adds a keyless account to the already-unlocked wallet.
 * The device is an injected fake connector — no WebHID or background.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import type { LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { bindLedgerFirstRun } from "../../../../src/sidepanel/journeys/ledger/first-run";
import { createLedgerOnboardEntry } from "../../../../src/sidepanel/journeys/ledger/onboard-entry";
import type { LedgerConnector } from "../../../../src/sidepanel/journeys/ledger/sign-session";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

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
    startLedgerSetup: (networkId, vaultPassphrase) => {
      captured.push([networkId, vaultPassphrase]);
    },
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

  test("Enter in a passphrase field continues only once the button is enabled", () => {
    const { app, captured } = mountOnboarding(mainnetStatus);
    const enter = (): boolean => {
      const event = new window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      });
      app.querySelector('input[name="ledgerVaultPassphraseConfirm"]')?.dispatchEvent(event);
      return event.defaultPrevented;
    };
    setValue(app, 'input[name="ledgerVaultPassphrase"]', PASSPHRASE);
    setValue(app, 'input[name="ledgerVaultPassphraseConfirm"]', `${PASSPHRASE}x`);
    expect(enter()).toBe(true);
    expect(captured).toEqual([]);
    setValue(app, 'input[name="ledgerVaultPassphraseConfirm"]', PASSPHRASE);
    expect(enter()).toBe(true);
    expect(captured).toEqual([["SN_MAIN", PASSPHRASE]]);
  });

  test("gates the button on a confirmed passphrase and renders no acknowledgement", () => {
    const { app, captured } = mountOnboarding(mainnetStatus);
    const button = app.querySelector<HTMLButtonElement>("#ledger-setup-button");
    expect(button?.disabled).toBe(true);

    setValue(app, 'input[name="ledgerVaultPassphrase"]', PASSPHRASE);
    // One field is not enough: the confirmation must agree.
    expect(button?.disabled).toBe(true);
    setValue(app, 'input[name="ledgerVaultPassphraseConfirm"]', PASSPHRASE);
    expect(button?.disabled).toBe(false);

    // The real-funds tickbox was removed in the copy review; nothing else gates
    // the button, so it must not reappear as a silent block.
    expect(app.querySelector("#ledger-mainnet-ack")).toBeNull();
    expect(app.querySelector('input[name="ledgerMainnetAck"]')).toBeNull();

    click(app, "#ledger-setup-button");
    expect(captured).toEqual([["SN_MAIN", PASSPHRASE]]);
  });

  test("accepts a weak passphrase without asking, and renders no acknowledgement", () => {
    const { app, captured } = mountOnboarding(mainnetStatus);
    const button = app.querySelector<HTMLButtonElement>("#ledger-setup-button");
    const weak = "aaaaaaaaaaaa";

    setValue(app, 'input[name="ledgerVaultPassphrase"]', weak);
    setValue(app, 'input[name="ledgerVaultPassphraseConfirm"]', weak);

    // Neither credential screen asks about a weak passphrase any more. The
    // control is not rendered, and setup is not gated on one — the length floor
    // is the only bar left, and the meter still bands the value.
    expect(app.querySelector("#ledger-weak-passphrase-ack")).toBeNull();
    expect(app.querySelector('input[name="ledgerWeakPassphraseAck"]')).toBeNull();
    expect(button?.disabled).toBe(false);
    click(app, "#ledger-setup-button");
    expect(captured).toEqual([["SN_MAIN", weak]]);
  });

  test("shows a passphrase hint for a too-short passphrase", () => {
    const { app } = mountOnboarding(mainnetStatus);
    setValue(app, 'input[name="ledgerVaultPassphrase"]', "short");
    expect(app.querySelector("#ledger-passphrase-result")?.textContent).toContain(
      `at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`,
    );
  });

  test("pins first-run Ledger setup to Mainnet without a network dropdown", () => {
    const { app, captured } = mountOnboarding({
      ...mainnetStatus,
      network: "Starknet Sepolia",
      networkId: "SN_SEPOLIA",
    });
    setValue(app, 'input[name="ledgerVaultPassphrase"]', PASSPHRASE);
    setValue(app, 'input[name="ledgerVaultPassphraseConfirm"]', PASSPHRASE);
    click(app, "#ledger-setup-button");
    expect(app.querySelector('select[name="ledgerNetworkId"]')).toBeNull();
    expect(captured).toEqual([["SN_MAIN", PASSPHRASE]]);
  });

  test("blocks setup and toasts when the passphrase is too short at click time", () => {
    const { app, captured } = mountOnboarding(mainnetStatus);
    click(app, "#ledger-setup-button");
    expect(captured).toEqual([]);
    expect(document.querySelector(".toast.error")?.textContent).toContain(
      `at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`,
    );
  });
});

const enumerateClient: LedgerDeviceClient = {
  getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
  getAppVersion: () =>
    Promise.resolve({
      errorMessage: "No errors",
      major: 2,
      minor: 4,
      patch: 0,
      returnCode: 0x9000,
    }),
  getPubKey: () =>
    Promise.resolve({
      errorMessage: "No errors",
      publicKey: new Uint8Array([...new Array(31).fill(0), 7, ...new Array(32).fill(0)]),
      returnCode: 0x9000,
    }),
  signHash: () => Promise.reject(new Error("unused")),
};

const candidate = (
  index: number,
  accountContractType: "argent" | "openzeppelin" = "openzeppelin",
): LedgerAccountRef => {
  const address = `0x${accountContractType === "argent" ? "e" : ""}${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`;
  return {
    ...(accountContractType === "argent"
      ? ({ accountContractType, deploymentSalt: "0x1" } as const)
      : ({ accountContractType } as const)),
    address,
    classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    derivation: {
      accountIndex: index,
      eip2645application: "LedgerW",
      kind: "ledger",
      path: ledgerAccountPath(index),
    },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: `0x${index + 1}`,
  };
};

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
    deriveLedgerAccounts: (
      _networkId: string,
      _entries: readonly unknown[],
      accountContractType: "argent" | "openzeppelin",
    ) => Promise.resolve([candidate(0, accountContractType), candidate(1, accountContractType)]),
    ledgerAccountStatus: () => Promise.resolve({ balance: null, deployed: null }),
    loadStatus: () => Promise.resolve(mainnetStatus),
  } as unknown as SidepanelWallet;
  let refreshed = 0;
  let multisigs = 0;
  const entry = createLedgerOnboardEntry({
    addHd: () => Promise.resolve(),
    cache,
    connector,
    mount,
    openImport: () => undefined,
    openFindAccounts: () => undefined,
    openImportSeed: () => undefined,
    openMultisig: () => {
      multisigs += 1;
    },
    refresh: () => {
      refreshed += 1;
      return Promise.resolve();
    },
    wallet,
  });
  return { added, created, entry, mount, multisigs: () => multisigs, refreshed: () => refreshed };
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
    check(h.mount, `[data-ledger-toggle="${candidate(1).id}"]`);
    click(h.mount, "[data-ledger-add-selected]");
    await tick();

    expect(h.created).toEqual([["SN_MAIN", 1, candidate(1).publicKeyX, PASSPHRASE]]);
    expect(h.added).toEqual([]);
    expect(h.refreshed()).toBe(1);
  });

  test("opens add-account setup directly from the entry API", () => {
    const h = entryHarness();

    h.entry.startAddAccount();

    expect(h.mount.hidden).toBe(false);
  });

  test("routes the confirmed Multisig choice through the shared entry", () => {
    const h = entryHarness();
    h.entry.startAddAccount();

    expect(h.multisigs()).toBe(0);
    click(h.mount, '[data-add-kind="multisig"]');

    expect(h.mount.hidden).toBe(true);
    expect(h.multisigs()).toBe(1);
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
    check(h.mount, `[data-ledger-toggle="${candidate(0).id}"]`);
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
    check(h.mount, `[data-ledger-toggle="${candidate(0).id}"]`);
    click(h.mount, "[data-ledger-add-selected]");
    await tick();

    expect(h.created).toEqual([]);
    expect(h.added).toEqual([["SN_MAIN", 0, candidate(0).publicKeyX]]);
  });
});
