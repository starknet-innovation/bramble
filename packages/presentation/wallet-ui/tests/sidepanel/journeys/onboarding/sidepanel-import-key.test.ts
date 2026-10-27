/**
 * Behavioural coverage for the "Import private key" form, driven through the
 * real `bindImportKey` binding under happy-dom. This is the UI entry point for
 * the most secret-sensitive flow, so the suite asserts the pasted key is
 * forwarded verbatim to `wallet.importAccount` (never mangled), the form is
 * cleared on success so the key does not linger in the DOM, an empty field is a
 * no-op with a prompt, and a rejected import surfaces the error without adding
 * an account or leaving the flow in a busy state.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type { AccountContractType } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type { ReadyKeyCandidate } from "../../../../src/popup/responses/responses-onboarding";
import { importKeyFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindImportKey } from "../../../../src/sidepanel/journeys/settings/import-key-ui";
import type { SettingsUiDeps } from "../../../../src/sidepanel/journeys/settings/settings-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const PASTED_KEY = "0xfeedface";
const ARGENT_031 = "0x29927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";

// A Ready-key discovery row: the key's 0.3.1 address, deployed.
const DEPLOYED_031: ReadyKeyCandidate = {
  accountId: "SN_MAIN:0xa031",
  address: "0xa031",
  classHash: ARGENT_031,
  deployed: true,
};

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

type Harness = {
  readonly container: HTMLElement;
  readonly discoverCalls: ReadonlyArray<readonly [string, string, string | undefined]>;
  readonly pickedCalls: ReadonlyArray<readonly string[] | undefined>;
  readonly importCalls: ReadonlyArray<
    readonly [string, string, AccountContractType, string | undefined]
  >;
  readonly renderCount: () => number;
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Mounts the dedicated import-key flow and wires the
// real binding against a recording fake wallet whose importAccount can be told
// to resolve or reject.
const mount = (
  importAccount: (
    networkId: string,
    key: string,
    accountContractType: AccountContractType,
    deploymentSalt?: string,
  ) => Promise<string>,
  repaint = true,
  discover: () => Promise<readonly ReadyKeyCandidate[]> = () => Promise.resolve([DEPLOYED_031]),
): Harness => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "app";
  document.body.append(container);

  const importCalls: Array<readonly [string, string, AccountContractType, string | undefined]> = [];
  const discoverCalls: Array<readonly [string, string, string | undefined]> = [];
  const pickedCalls: Array<readonly string[] | undefined> = [];
  let renders = 0;

  const wallet = {
    discoverReadyKeyAccounts: (
      networkId: string,
      key: string,
      deploymentSalt?: string,
    ): Promise<readonly ReadyKeyCandidate[]> => {
      discoverCalls.push([networkId, key, deploymentSalt]);
      return discover();
    },
    importAccount: (
      networkId: string,
      key: string,
      accountContractType: AccountContractType,
      deploymentSalt?: string,
      classHashes?: readonly string[],
    ): Promise<string> => {
      importCalls.push([networkId, key, accountContractType, deploymentSalt]);
      pickedCalls.push(classHashes);
      return importAccount(networkId, key, accountContractType, deploymentSalt);
    },
  };

  const paint = (): void => {
    container.replaceChildren(
      document.createRange().createContextualFragment(importKeyFlow(status)),
    );
    const deps: SettingsUiDeps = {
      app: container,
      expandedGroup: () => null,
      networkId: () => "SN_MAIN",
      refresh: () => Promise.resolve(status),
      render: async () => {
        renders += 1;
        // The real paint loop skips an unchanged scene, leaving the old form.
        if (repaint) paint();
      },
      setExpandedGroup: () => undefined,
      startAddAccount: () => undefined,
      wallet: wallet as unknown as SettingsUiDeps["wallet"],
    };
    bindImportKey(deps);
  };

  paint();
  return { container, discoverCalls, importCalls, pickedCalls, renderCount: () => renders };
};

const submitKey = (container: HTMLElement, key: string, deploymentSalt?: string): void => {
  const form = container.querySelector<HTMLFormElement>("#import-key-form");
  const textarea = form?.querySelector<HTMLTextAreaElement>('textarea[name="rawKey"]');
  if (!form || !textarea) {
    throw new Error("import-key form missing");
  }
  textarea.value = key;
  const salt = form.querySelector<HTMLInputElement>('input[name="deploymentSalt"]');
  if (salt) salt.value = deploymentSalt ?? "";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
};

describe("Import private key form", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("forwards the pasted key verbatim, clears the field, and re-renders", async () => {
    const harness = mount(() => Promise.resolve(account.id));

    submitKey(harness.container, PASTED_KEY);
    await tick();

    // The key reaches the privileged import request exactly as pasted, tagged
    // with the active network.
    expect(harness.importCalls).toEqual([["SN_MAIN", PASTED_KEY, "openzeppelin", undefined]]);
    // Success re-renders the flow...
    expect(harness.renderCount()).toBe(1);
    // ...and the key no longer lives anywhere in the DOM (form was reset before
    // the re-render, and the response never carries it back).
    expect(harness.container.innerHTML).not.toContain(PASTED_KEY);
    const textarea = harness.container.querySelector<HTMLTextAreaElement>(
      '#import-key-form textarea[name="rawKey"]',
    );
    expect(textarea?.value ?? "").toBe("");
  });

  test("success leaves the form ready when the paint loop does not repaint", async () => {
    let attempts = 0;
    const harness = mount(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("Account already exists"))
        : Promise.resolve(account.id);
    }, false);
    submitKey(harness.container, PASTED_KEY);
    await tick();
    const result = harness.container.querySelector("#import-key-result");
    expect(result?.textContent).toBe("Account already exists");

    submitKey(harness.container, PASTED_KEY);
    await tick();
    expect(harness.renderCount()).toBe(1);
    const button = harness.container.querySelector<HTMLButtonElement>(
      '#import-key-form button[type="submit"]',
    );
    // Not stuck busy, and the earlier failure no longer sits under the success.
    expect(button?.disabled).toBe(false);
    expect(button?.hasAttribute("data-busy")).toBe(false);
    expect(result?.textContent).toBe("");
    expect(
      harness.container.querySelector<HTMLTextAreaElement>('textarea[name="rawKey"]')?.value,
    ).toBe("");
  });

  test("states that the key controls the account", () => {
    // Cut by the copy review and restored as one fact (mc-wallet #476).
    const harness = mount(() => Promise.resolve(account.id));
    expect(harness.container.querySelector('[role="note"]')?.textContent).toBe(
      "Anyone with this key controls the account.",
    );
  });

  test("an empty field is a no-op that prompts for a key", async () => {
    const harness = mount(() => Promise.resolve(account.id));

    submitKey(harness.container, "   ");
    await tick();

    expect(harness.importCalls).toEqual([]);
    expect(harness.renderCount()).toBe(0);
    expect(harness.container.querySelector("#import-key-result")?.textContent).toBe(
      "Enter a private key to import",
    );
  });

  test("forwards an explicit Argent deployment salt to discovery and the import", async () => {
    const harness = mount(() => Promise.resolve(account.id));
    const contract = harness.container.querySelector<HTMLSelectElement>(
      'select[name="accountContractType"]',
    );
    if (!contract) throw new Error("import contract field missing");
    contract.value = "argent";
    contract.dispatchEvent(new window.Event("change", { bubbles: true }));

    // A Ready key lists its accounts first, then imports the ticked ones.
    const form = harness.container.querySelector<HTMLFormElement>("#import-key-form");
    const salt = form?.querySelector<HTMLInputElement>('input[name="deploymentSalt"]');
    const raw = form?.querySelector<HTMLTextAreaElement>('textarea[name="rawKey"]');
    if (!form || !salt || !raw) throw new Error("import-key form missing");
    raw.value = PASTED_KEY;
    salt.value = "0x777";
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(harness.discoverCalls).toEqual([["SN_MAIN", PASTED_KEY, "0x777"]]);
    expect(harness.importCalls).toEqual([]);
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await tick();

    expect(harness.importCalls).toEqual([["SN_MAIN", PASTED_KEY, "argent", "0x777"]]);
    expect(harness.pickedCalls).toEqual([[ARGENT_031]]);
  });

  test("clears and omits the Argent salt when OpenZeppelin is selected", async () => {
    const harness = mount(() => Promise.resolve(account.id));
    const contract = harness.container.querySelector<HTMLSelectElement>(
      'select[name="accountContractType"]',
    );
    const salt = harness.container.querySelector<HTMLInputElement>('input[name="deploymentSalt"]');
    if (!contract || !salt) throw new Error("import contract fields missing");
    contract.value = "argent";
    contract.dispatchEvent(new window.Event("change", { bubbles: true }));
    salt.value = "0x777";
    contract.value = "openzeppelin";
    contract.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(salt.value).toBe("");
    expect(salt.disabled).toBe(true);
    salt.disabled = false;
    submitKey(harness.container, PASTED_KEY, "0x999");
    await tick();
    expect(harness.importCalls).toEqual([["SN_MAIN", PASTED_KEY, "openzeppelin", undefined]]);
  });

  test("a rejected import surfaces the error and adds no account", async () => {
    const harness = mount(() => Promise.reject(new Error("Account already exists")));

    submitKey(harness.container, PASTED_KEY);
    await tick();

    expect(harness.importCalls).toEqual([["SN_MAIN", PASTED_KEY, "openzeppelin", undefined]]);
    // No re-render on failure — the flow stays put and shows the reason.
    expect(harness.renderCount()).toBe(0);
    expect(harness.container.querySelector("#import-key-result")?.textContent).toBe(
      "Account already exists",
    );
  });
});
