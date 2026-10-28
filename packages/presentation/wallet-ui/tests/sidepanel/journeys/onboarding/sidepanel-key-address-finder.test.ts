/**
 * "Can't find it? Paste the account address" on both private-key import forms
 * (issue 779), driven through the real bindings under happy-dom. The finder
 * appears only once Ready discovery has answered (a picker, or no account),
 * looks up the address for exactly the key, salt and network that discovery
 * ran for, replaces the picker with the found account, and the import then
 * names that account by address. Any input change hides it and drops a lookup
 * still on its way.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type { KeyAddressCandidate } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { importKeyFlow } from "../../../../src/sidepanel/app/screens/flows";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import { bindImportKey } from "../../../../src/sidepanel/journeys/settings/import-key-ui";
import type { SettingsUiDeps } from "../../../../src/sidepanel/journeys/settings/settings-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import type { ReadyKeyPick } from "../../../../src/sidepanel/runtime/runtime-accounts";
import { networkChangeAnnouncer } from "../../../../src/sidepanel/shared/network-change";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// Clearly-fake test vector; not a real key.
const RAW_KEY = "0xfeedface";
const PASSPHRASE = "fixture vault passphrase";
const ARGENT_040 = "0x36078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";
const FOUND: KeyAddressCandidate = {
  accountId: "SN_MAIN:0x7e57ad0e55",
  address: "0x7e57ad0e55",
  byAddress: true,
  classHash: ARGENT_040,
  deployed: true,
};
const NOT_FOUND = new Error("No Ready account found for this key");

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setValue = (root: ParentNode, selector: string, value: string): void => {
  const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (!input) throw new Error(`missing ${selector}`);
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
};

const click = (root: ParentNode, selector: string): void => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`missing ${selector}`);
  button.click();
};

type Lookup = readonly [string, string, string | undefined, string];

const wallet = (options: {
  readonly discover?: () => Promise<unknown>;
  readonly find?: () => Promise<KeyAddressCandidate>;
}) => {
  const lookups: Lookup[] = [];
  const picks: (ReadyKeyPick | undefined)[] = [];
  const keys: string[] = [];
  const record = (key: string, pick?: ReadyKeyPick) => {
    keys.push(key);
    picks.push(pick);
    return Promise.resolve("SN_MAIN:0x7e57ad0e55");
  };
  return {
    keys,
    lookups,
    picks,
    wallet: {
      createKeyVault: (
        _network: string,
        key: string,
        _passphrase: string,
        _type: string,
        _salt?: string,
        pick?: ReadyKeyPick,
      ) => record(key, pick),
      discoverReadyKeyAccounts: () => options.discover?.() ?? Promise.reject(NOT_FOUND),
      findKeyAccountByAddress: (
        networkId: string,
        key: string,
        salt: string | undefined,
        address: string,
      ) => {
        lookups.push([networkId, key, salt, address]);
        return options.find?.() ?? Promise.resolve(FOUND);
      },
      importAccount: (
        _network: string,
        key: string,
        _type: string,
        _salt?: string,
        pick?: ReadyKeyPick,
      ) => record(key, pick),
      loadStatus: () => Promise.resolve({ ...firstRun, accountCount: 1, hasVault: true }),
    },
  };
};

const firstRun: WalletStatus = {
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

const onboardingFlow = (options: Parameters<typeof wallet>[0] = {}) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(firstRun)));
  document.body.append(app);
  const fake = wallet(options);
  bindOnboarding({
    app,
    render: async () => undefined,
    wallet: fake.wallet as unknown as SidepanelWallet,
  });
  const announce = networkChangeAnnouncer(app);
  announce("SN_MAIN");
  click(app, "#add-existing-button");
  click(app, "#key-method-button");
  setValue(app, 'select[name="importKeyContractType"]', "argent");
  setValue(app, 'textarea[name="importKeyRaw"]', RAW_KEY);
  return { ...fake, announce, app };
};

const finder = (root: ParentNode) =>
  root.querySelector<HTMLDetailsElement>('[data-recovery-address="key"]');

const find = async (root: ParentNode, address = "https://voyager.online/contract/0x7e57ad0e55") => {
  setValue(root, 'input[name="keyAddress"]', address);
  click(root, "#key-address-search");
  await tick();
  await tick();
};

describe("first-run private-key import by address", () => {
  beforeEach(() => document.body.replaceChildren());

  test("stays hidden until discovery has found no account, then offers the finder", async () => {
    const flow = onboardingFlow();
    expect(finder(flow.app)?.hidden).toBe(true);
    click(flow.app, "#import-key-continue");
    await tick();
    expect(finder(flow.app)?.hidden).toBe(false);
  });

  test("an unreadable chain does not offer it", async () => {
    const flow = onboardingFlow({
      discover: () => Promise.reject(new Error("Ready account check unavailable")),
    });
    click(flow.app, "#import-key-continue");
    await tick();
    expect(finder(flow.app)?.hidden).toBe(true);
  });

  test("finds the account for the discovered key and creates the vault by its address", async () => {
    const flow = onboardingFlow();
    setValue(flow.app, 'input[name="importKeySalt"]', "0x5a17");
    click(flow.app, "#import-key-continue");
    await tick();
    await find(flow.app);
    expect(flow.lookups).toEqual([["SN_MAIN", RAW_KEY, "0x5a17", "0x7e57ad0e55"]]);
    expect(flow.app.querySelector("#key-address-result")?.textContent).toBe("Found your account.");
    expect(flow.app.querySelectorAll("[data-ready-key-picker] input:checked")).toHaveLength(1);
    click(flow.app, "#import-key-continue");
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#password-continue-button");
    await tick();
    expect(flow.picks).toEqual([{ address: "0x7e57ad0e55", classHash: ARGENT_040 }]);
  });

  test("a guardian account is found view only", async () => {
    const flow = onboardingFlow({
      find: () => Promise.resolve({ ...FOUND, restriction: "guardian" }),
    });
    click(flow.app, "#import-key-continue");
    await tick();
    await find(flow.app);
    expect(flow.app.querySelector("#key-address-result")?.textContent).toBe(
      "Found your account. It's view only until you recover it.",
    );
  });

  test("a refusal is shown in the reader's words", async () => {
    const flow = onboardingFlow({
      find: () => Promise.reject(new Error("private key does not control this account")),
    });
    click(flow.app, "#import-key-continue");
    await tick();
    await find(flow.app);
    expect(flow.app.querySelector("#key-address-result")?.textContent).toBe(
      "This private key doesn't control that account.",
    );
    expect(flow.app.querySelector("[data-ready-key-picker]")).toBeNull();
  });

  for (const [input, selector] of [
    ["key", 'textarea[name="importKeyRaw"]'],
    ["salt", 'input[name="importKeySalt"]'],
  ] as const) {
    test(`a ${input} edited during a lookup hides the finder and drops the answer`, async () => {
      let answer: (candidate: KeyAddressCandidate) => void = () => undefined;
      const flow = onboardingFlow({
        find: () => new Promise((resolve) => (answer = resolve)),
      });
      click(flow.app, "#import-key-continue");
      await tick();
      setValue(flow.app, 'input[name="keyAddress"]', "0x7e57ad0e55");
      click(flow.app, "#key-address-search");
      setValue(flow.app, selector, "0xbeef");
      answer(FOUND);
      await tick();
      expect(finder(flow.app)?.hidden).toBe(true);
      expect(flow.app.querySelector("[data-ready-key-picker]")).toBeNull();
      expect(flow.app.querySelector("#key-address-result")?.textContent).toBe("");
    });
  }

  test("a network change during a lookup drops the answer", async () => {
    let answer: (candidate: KeyAddressCandidate) => void = () => undefined;
    const flow = onboardingFlow({ find: () => new Promise((resolve) => (answer = resolve)) });
    click(flow.app, "#import-key-continue");
    await tick();
    setValue(flow.app, 'input[name="keyAddress"]', "0x7e57ad0e55");
    click(flow.app, "#key-address-search");
    flow.announce("SN_SEPOLIA");
    answer(FOUND);
    await tick();
    expect(finder(flow.app)?.hidden).toBe(true);
    expect(flow.app.querySelector("[data-ready-key-picker]")).toBeNull();
  });
});

const settingsFlow = (
  options: Parameters<typeof wallet>[0] & { readonly duplicate?: boolean } = {},
) => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "app";
  document.body.append(container);
  const fake = wallet(options);
  const inWallet = { ...firstRun, accountCount: 1, accounts: [account], hasVault: true };
  container.replaceChildren(
    document.createRange().createContextualFragment(importKeyFlow(inWallet)),
  );
  const deps: SettingsUiDeps = {
    app: container,
    existingAccountIds: () => new Set(["SN_MAIN:0x7e57ad0e55"].filter(() => options.duplicate)),
    expandedGroup: () => null,
    networkId: () => "SN_MAIN",
    refresh: () => Promise.resolve(inWallet),
    render: async () => undefined,
    setExpandedGroup: () => undefined,
    startAddAccount: () => undefined,
    wallet: fake.wallet as unknown as SettingsUiDeps["wallet"],
  };
  bindImportKey(deps);
  const form = container.querySelector<HTMLFormElement>("#import-key-form");
  setValue(container, 'select[name="accountContractType"]', "argent");
  setValue(container, 'textarea[name="rawKey"]', RAW_KEY);
  const submit = () =>
    form?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  return { ...fake, container, submit };
};

describe("Settings private-key import by address", () => {
  beforeEach(() => document.body.replaceChildren());

  test("offers the finder below a listed picker and imports the found account by address", async () => {
    const flow = settingsFlow({
      discover: () =>
        Promise.resolve([
          { accountId: "SN_MAIN:0xa031", address: "0xa031", classHash: ARGENT_040, deployed: true },
        ]),
    });
    expect(finder(flow.container)?.hidden).toBe(true);
    flow.submit();
    await tick();
    expect(finder(flow.container)?.hidden).toBe(false);
    await find(flow.container, "0x7e57ad0e55");
    // The found account replaced the release picker.
    const rows = flow.container.querySelectorAll("[data-ready-key-picker] code");
    expect([...rows].map((row) => row.getAttribute("title"))).toEqual(["0x7e57ad0e55"]);
    flow.submit();
    await tick();
    expect(flow.keys).toEqual([RAW_KEY]);
    expect(flow.picks).toEqual([{ address: "0x7e57ad0e55", classHash: ARGENT_040 }]);
  });

  test("an account already in the wallet is shown locked and cannot be imported", async () => {
    const flow = settingsFlow({ duplicate: true });
    flow.submit();
    await tick();
    await find(flow.container, "0x7e57ad0e55");
    const box = flow.container.querySelector<HTMLInputElement>("[data-ready-key-picker] input");
    expect(box?.disabled).toBe(true);
    expect(
      flow.container.querySelector<HTMLButtonElement>('#import-key-form button[type="submit"]')
        ?.disabled,
    ).toBe(true);
  });

  test("a key edited after a lookup hides the finder and drops the found account", async () => {
    let answer: (candidate: KeyAddressCandidate) => void = () => undefined;
    const flow = settingsFlow({ find: () => new Promise((resolve) => (answer = resolve)) });
    flow.submit();
    await tick();
    setValue(flow.container, 'input[name="keyAddress"]', "0x7e57ad0e55");
    click(flow.container, "#key-address-search");
    setValue(flow.container, 'textarea[name="rawKey"]', "0xbeef");
    answer(FOUND);
    await tick();
    expect(finder(flow.container)?.hidden).toBe(true);
    expect(flow.container.querySelector("[data-ready-key-picker]")).toBeNull();
    expect(flow.container.querySelector("#key-address-result")?.textContent).toBe("");
  });

  test("a link for another network is named, not searched", async () => {
    const flow = settingsFlow();
    flow.submit();
    await tick();
    await find(flow.container, "https://sepolia.voyager.online/contract/0x7e57ad0e55");
    expect(flow.lookups).toEqual([]);
    expect(flow.container.querySelector("#key-address-result")?.textContent).toBe(
      "That link is for Starknet Sepolia, not Starknet Mainnet.",
    );
  });
});
