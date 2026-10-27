/**
 * Staged-onboarding coverage for the first-run private-key route: the method
 * screen's "Private key" option gates Continue on a key plus the Mainnet
 * acknowledgement, the shared passphrase step's CTA becomes "Create wallet",
 * and completion sends exactly one createKeyVault request (salt only for
 * Ready) without touching mnemonic paths.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const PASSPHRASE = "fixture vault passphrase";
// Clearly-fake test vector; not a real key.
const RAW_KEY = "0xfeedface";

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

// The key's 0.3.1 address, deployed: the one row a Ready key lists here.
const ARGENT_031 = "0x29927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";
const DEPLOYED_031 = {
  accountId: "SN_MAIN:0xa031",
  address: "0xa031",
  classHash: ARGENT_031,
  deployed: true,
} as const;

const mount = (options?: { readonly createKeyVault?: () => Promise<string> }) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  const created: Array<readonly [string, string, string, string, string | undefined]> = [];
  const picked: Array<readonly string[] | undefined> = [];
  const discovered: Array<readonly [string, string, string | undefined]> = [];
  let renders = 0;
  const wallet = {
    createKeyVault(
      networkId: string,
      privateKey: string,
      vaultPassphrase: string,
      accountContractType: string,
      deploymentSalt?: string,
      classHashes?: readonly string[],
    ) {
      created.push([networkId, privateKey, vaultPassphrase, accountContractType, deploymentSalt]);
      picked.push(classHashes);
      return options?.createKeyVault?.() ?? Promise.resolve("SN_MAIN:0x1");
    },
    discoverReadyKeyAccounts(networkId: string, privateKey: string, deploymentSalt?: string) {
      discovered.push([networkId, privateKey, deploymentSalt]);
      return Promise.resolve([DEPLOYED_031]);
    },
    loadStatus: () => Promise.resolve({ ...status, accountCount: 1, hasVault: true }),
  } as unknown as SidepanelWallet;
  bindOnboarding({
    app,
    render: async () => {
      renders += 1;
    },
    wallet,
  });
  return { app, created, discovered, picked, renders: () => renders };
};

describe("onboarding private-key import", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("gates Continue on a key, with no acknowledgement left to tick", () => {
    const flow = mount();
    click(flow.app, "#add-existing-button");
    click(flow.app, "#key-method-button");
    expect(activeStep(flow.app)).toBe("import-key");
    // The consequence of holding the key stays on the step (mc-wallet #476).
    expect(
      flow.app.querySelector('[data-onboarding-step="import-key"] [role="note"]')?.textContent,
    ).toBe("Anyone with this key controls the account.");

    const continueButton = flow.app.querySelector<HTMLButtonElement>("#import-key-continue");
    expect(continueButton?.disabled).toBe(true);
    setValue(flow.app, 'textarea[name="importKeyRaw"]', RAW_KEY);
    expect(continueButton?.disabled).toBe(false);
    // The real-funds tickbox was removed in the copy review. A gate that
    // survived it would leave Continue permanently dead on this step.
    expect(flow.app.querySelector("#import-key-mainnet-ack")).toBeNull();
    expect(flow.app.querySelector('input[name="importKeyMainnetAck"]')).toBeNull();
    setValue(flow.app, 'textarea[name="importKeyRaw"]', "  ");
    expect(continueButton?.disabled).toBe(true);
  });

  test("creates the key vault from the passphrase step and renders the wallet", async () => {
    const flow = mount();
    click(flow.app, "#add-existing-button");
    click(flow.app, "#key-method-button");
    setValue(flow.app, 'textarea[name="importKeyRaw"]', ` ${RAW_KEY} `);
    click(flow.app, "#import-key-continue");
    expect(activeStep(flow.app)).toBe("password");
    expect(
      flow.app.querySelector<HTMLButtonElement>("#password-continue-button")?.textContent,
    ).toContain("Create wallet");

    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#password-continue-button");
    await tick();

    // The key is trimmed; the Bramble contract sends no salt.
    expect(flow.created).toEqual([["SN_MAIN", RAW_KEY, PASSPHRASE, "openzeppelin", undefined]]);
    expect(flow.renders()).toBe(1);
  });

  test("passes the salt only for a Ready account and surfaces failures in place", async () => {
    const flow = mount({
      createKeyVault: () => Promise.reject(new Error("Wallet already exists")),
    });
    click(flow.app, "#add-existing-button");
    click(flow.app, "#key-method-button");
    setValue(flow.app, 'select[name="importKeyContractType"]', "argent");
    setValue(flow.app, 'textarea[name="importKeyRaw"]', RAW_KEY);
    setValue(flow.app, 'input[name="importKeySalt"]', "0x777");
    // A Ready key lists its accounts first; the deployed one starts ticked.
    click(flow.app, "#import-key-continue");
    await tick();
    expect(flow.discovered).toEqual([["SN_MAIN", RAW_KEY, "0x777"]]);
    expect(activeStep(flow.app)).toBe("import-key");
    expect(flow.app.querySelector("[data-ready-key-picker]")).not.toBeNull();
    click(flow.app, "#import-key-continue");
    expect(activeStep(flow.app)).toBe("password");
    setValue(flow.app, 'input[name="vaultPassphrase"]', PASSPHRASE);
    setValue(flow.app, 'input[name="vaultPassphraseConfirm"]', PASSPHRASE);
    click(flow.app, "#password-continue-button");
    await tick();

    expect(flow.created).toEqual([["SN_MAIN", RAW_KEY, PASSPHRASE, "argent", "0x777"]]);
    expect(flow.picked).toEqual([[ARGENT_031]]);
    expect(flow.renders()).toBe(0);
    expect(flow.app.querySelector("#import-key-result")?.textContent).toBe("Wallet already exists");
  });
});
