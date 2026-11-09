/**
 * After a successful in-wallet phrase import the screen stays as it was, so
 * the binder itself must drop every trace of the phrase (audit #250): the
 * retained copy the scan reads, the suggestion panel, the 24-word layout, the
 * scan status, and any scan or validation still in flight that would put the
 * phrase or its accounts back after the wipe.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { importPhraseFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindImportPhrase } from "../../../../src/sidepanel/journeys/settings/import-phrase-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const account = {
  accountContractType: "openzeppelin",
  address: "0x11abc",
  classHash: "0x2",
  derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x11abc",
  networkId: "SN_MAIN",
  publicKeyX: "0x3",
  publicKeyY: "0x4",
} as DerivedAccountRef;

const scanResult = {
  candidates: [{ account, deployed: true, funded: false }],
  complete: true,
  nextIndex: 20,
  ok: true as const,
};

const tick = async (): Promise<void> => {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** A promise the test settles by hand, to hold a request in flight. */
type Gate<T> = { readonly promise: Promise<T>; readonly resolve: (value: T) => void };
const gate = <T>(): Gate<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

/** Requests the next call should hold open instead of answering at once. */
type Held = {
  discover?: Gate<typeof scanResult>;
  importSeed?: Gate<unknown>;
  validate?: Gate<boolean>;
};

const mount = () => {
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(importPhraseFlow(status)));
  document.body.replaceChildren(app);
  const discovered: string[] = [];
  const held: Held = {};
  const take = <K extends keyof Held>(key: K): Held[K] => {
    const next = held[key];
    delete held[key];
    return next;
  };
  const wallet = {
    discoverRecoveryAccounts: (mnemonic: string) => {
      discovered.push(mnemonic);
      return take("discover")?.promise ?? Promise.resolve(scanResult);
    },
    importSeedAccounts: () => take("importSeed")?.promise ?? Promise.resolve([account]),
    loadStatus: () => Promise.resolve(status),
    validateMnemonic: () => take("validate")?.promise ?? Promise.resolve(true),
  } as unknown as SidepanelWallet;
  bindImportPhrase({
    app,
    expandedGroup: () => null,
    networkId: () => "SN_MAIN",
    refresh: () => wallet.loadStatus(),
    render: async () => undefined,
    setExpandedGroup: () => undefined,
    startAddAccount: () => undefined,
    wallet,
  });
  return { app, discovered, held };
};

const cell = (root: ParentNode, index: number): HTMLInputElement => {
  const input = root.querySelector<HTMLInputElement>(`input[name="import-word-${index}"]`);
  if (!input) throw new Error(`missing word ${index}`);
  return input;
};

const type = (input: HTMLInputElement, value: string): void => {
  const field = input;
  field.focus();
  field.value = value;
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const click = (root: ParentNode, selector: string): void => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`missing ${selector}`);
  button.click();
};

const searchPhrase = async (root: ParentNode, phrase = MNEMONIC): Promise<void> => {
  type(cell(root, 0), phrase);
  click(root, "#import-phrase-search");
  await tick();
};

const scanVisible = (root: ParentNode): boolean =>
  root.querySelector<HTMLElement>("#import-phrase-scan")?.hidden === false;

describe("import-phrase wipe after a successful import", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("drops the retained phrase, the scan status, and the suggestion panel", async () => {
    const flow = mount();
    await searchPhrase(flow.app);
    expect(flow.discovered).toEqual([MNEMONIC]);
    expect(flow.app.querySelector("#recovery-scan-status")?.textContent).toContain("complete");
    // A cell edited after the search leaves the suggestion panel open.
    type(cell(flow.app, 0), "le");
    expect(flow.app.querySelector(".recovery-suggestions")?.hasAttribute("hidden")).toBe(false);

    click(flow.app, "#recover-accounts-button");
    await tick();

    expect(flow.app.querySelector("#recovery-scan-status")?.textContent).toBe("");
    const panel = flow.app.querySelector(".recovery-suggestions");
    expect(panel?.hasAttribute("hidden")).toBe(true);
    expect(panel?.textContent).toBe("");
    // The scan reads the retained copy: a retry now has no phrase to send.
    click(flow.app, "#recovery-scan-retry");
    await tick();
    expect(flow.discovered).toEqual([MNEMONIC, ""]);
  });

  test("a 24-word import resets the grid and the length toggle", async () => {
    const flow = mount();
    await searchPhrase(flow.app, `${MNEMONIC} ${MNEMONIC}`);
    const toggle = flow.app.querySelector("#phrase-length-toggle");
    expect(toggle?.textContent).toContain("Use a 12-word phrase");
    click(flow.app, "#recover-accounts-button");
    await tick();
    expect(toggle?.textContent).toContain("Use a 24-word phrase");
    expect(cell(flow.app, 12).hidden).toBe(true);
    expect(cell(flow.app, 23).value).toBe("");
  });

  test("a Search pressed during the import cannot bring the phrase back", async () => {
    const flow = mount();
    await searchPhrase(flow.app);
    flow.held.importSeed = gate();
    const importing = flow.held.importSeed;
    click(flow.app, "#recover-accounts-button");
    flow.held.validate = gate();
    const validating = flow.held.validate;
    click(flow.app, "#import-phrase-search");
    await tick();

    importing.resolve([account]);
    await tick();
    validating.resolve(true);
    await tick();

    expect(scanVisible(flow.app)).toBe(false);
    expect(flow.discovered).toEqual([MNEMONIC]);
    const search = flow.app.querySelector<HTMLButtonElement>("#import-phrase-search");
    expect(search?.hasAttribute("data-busy")).toBe(false);
    expect(search?.disabled).toBe(true);
    click(flow.app, "#recovery-scan-retry");
    await tick();
    expect(flow.discovered).toEqual([MNEMONIC, ""]);
  });

  test("a scan still in flight is discarded and not restarted", async () => {
    const flow = mount();
    await searchPhrase(flow.app);
    // A retry holds a scan open; the import starts; a second Search queues a
    // restart behind the open scan. Then the import succeeds.
    flow.held.discover = gate();
    const scanning = flow.held.discover;
    click(flow.app, "#recovery-scan-retry");
    flow.held.importSeed = gate();
    const importing = flow.held.importSeed;
    click(flow.app, "#recover-accounts-button");
    click(flow.app, "#import-phrase-search");
    await tick();
    importing.resolve([account]);
    await tick();

    scanning.resolve(scanResult);
    await tick();
    expect(flow.app.querySelectorAll("input.select-check").length).toBe(0);
    expect(flow.discovered).toEqual([MNEMONIC, MNEMONIC]);
    expect(flow.app.querySelector("#recovery-scan-status")?.textContent).toBe("");
  });
});
