/**
 * The Ready-key picker (issue 776): a raw Ready key lists every Argent release
 * it controls an address in use at, and the user ticks which to import. A
 * deployed row starts ticked; a funded-only row never does, so dust sent to a
 * release's address can add a row but cannot add an account on its own. The
 * discovery answer is validated before it reaches the picker.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  isReadyKeyDiscoveryResponse,
  type ReadyKeyCandidate,
} from "../../../../src/popup/responses/responses-onboarding";
import { importKeyFlow } from "../../../../src/sidepanel/app/screens/flows";
import { mountReadyKeyPicker } from "../../../../src/sidepanel/journeys/onboarding/ready-key-picker";
import { bindImportKey } from "../../../../src/sidepanel/journeys/settings/import-key-ui";
import type { SettingsUiDeps } from "../../../../src/sidepanel/journeys/settings/settings-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const ARGENT_031 = "0x29927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";
const ARGENT_030 = "0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003";
const PASTED_KEY = "0xfeedface";

const deployed: ReadyKeyCandidate = {
  accountId: "SN_MAIN:0xa031",
  address: "0xa031",
  classHash: ARGENT_031,
  deployed: true,
};
const dusted: ReadyKeyCandidate = {
  accountId: "SN_MAIN:0xa030",
  address: "0xa030",
  classHash: ARGENT_030,
  deployed: false,
  holdings: [{ formatted: "0.000000000000000001", symbol: "ETH" }],
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const boxes = (root: ParentNode): HTMLInputElement[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>("[data-ready-key-class]"));

describe("mountReadyKeyPicker", () => {
  beforeEach(() => document.body.replaceChildren());

  test("ticks a deployed row, leaves a funded-only row for the user, and locks a duplicate", () => {
    const button = document.createElement("button");
    document.body.append(button);
    let changes = 0;
    const picker = mountReadyKeyPicker(
      button,
      [deployed, dusted, { ...deployed, accountId: "SN_MAIN:0xdup", address: "0xd0" }],
      new Set(["SN_MAIN:0xdup"]),
      () => {
        changes += 1;
      },
    );
    const [first, second, third] = boxes(document.body);
    expect(first?.checked).toBe(true);
    expect(second?.checked).toBe(false);
    expect(third?.disabled).toBe(true);
    expect(third?.checked).toBe(false);
    expect(document.body.textContent).toContain("Account · Argent 0.3.1");
    expect(document.body.textContent).toContain("Not deployed · holds 0.000000000000000001 ETH");
    expect(document.body.textContent).toContain("Already in this wallet");
    // The picker sits before the element it was mounted at.
    expect(button.previousElementSibling?.hasAttribute("data-ready-key-picker")).toBe(true);
    expect(picker.picked()).toEqual([ARGENT_031]);

    if (!second) throw new Error("missing funded row");
    second.checked = true;
    second.dispatchEvent(new window.Event("change"));
    expect(changes).toBe(1);
    expect(picker.picked()).toEqual([ARGENT_031, ARGENT_030]);

    picker.remove();
    expect(document.querySelector("[data-ready-key-picker]")).toBeNull();
  });
});

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

const mountSettings = (discover: () => Promise<readonly ReadyKeyCandidate[]>) => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  container.replaceChildren(document.createRange().createContextualFragment(importKeyFlow(status)));
  const imports: Array<readonly string[] | undefined> = [];
  const wallet = {
    discoverReadyKeyAccounts: discover,
    importAccount: (
      _networkId: string,
      _key: string,
      _type: string,
      _salt?: string,
      classHashes?: readonly string[],
    ) => {
      imports.push(classHashes);
      return Promise.resolve(account.id);
    },
  };
  bindImportKey({
    app: container,
    expandedGroup: () => null,
    networkId: () => "SN_MAIN",
    refresh: () => Promise.resolve(status),
    render: async () => undefined,
    setExpandedGroup: () => undefined,
    startAddAccount: () => undefined,
    wallet: wallet as unknown as SettingsUiDeps["wallet"],
  });
  const form = container.querySelector<HTMLFormElement>("#import-key-form");
  const contract = form?.querySelector<HTMLSelectElement>('select[name="accountContractType"]');
  const raw = form?.querySelector<HTMLTextAreaElement>('textarea[name="rawKey"]');
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !contract || !raw || !submit) throw new Error("import-key form missing");
  contract.value = "argent";
  contract.dispatchEvent(new window.Event("change"));
  raw.value = PASTED_KEY;
  const send = (): void => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  };
  return { container, imports, raw, send, submit };
};

describe("Settings → Import private key, Ready account", () => {
  test("imports only what the user ticks; dust alone adds nothing", async () => {
    const flow = mountSettings(() => Promise.resolve([deployed, dusted]));
    flow.send();
    await tick();
    expect(flow.imports).toEqual([]);
    expect(flow.submit.textContent).toContain("Import selected");
    flow.send();
    await tick();
    expect(flow.imports).toEqual([[ARGENT_031]]);
    // The import cleared the form and took the picker down.
    expect(flow.container.querySelector("[data-ready-key-picker]")).toBeNull();
  });

  test("a funded-only row is imported once the user ticks it", async () => {
    const flow = mountSettings(() => Promise.resolve([deployed, dusted]));
    flow.send();
    await tick();
    const funded = boxes(flow.container)[1];
    if (!funded) throw new Error("missing funded row");
    funded.checked = true;
    funded.dispatchEvent(new window.Event("change"));
    flow.send();
    await tick();
    expect(flow.imports).toEqual([[ARGENT_031, ARGENT_030]]);
  });

  test("nothing ticked keeps Import disabled and sends nothing", async () => {
    const flow = mountSettings(() => Promise.resolve([dusted]));
    flow.send();
    await tick();
    expect(flow.submit.disabled).toBe(true);
    flow.send();
    await tick();
    expect(flow.imports).toEqual([]);
  });

  test("a changed key drops the listed accounts", async () => {
    const flow = mountSettings(() => Promise.resolve([deployed]));
    flow.send();
    await tick();
    flow.raw.value = "0xbeef";
    flow.raw.dispatchEvent(new window.Event("input"));
    expect(flow.container.querySelector("[data-ready-key-picker]")).toBeNull();
    expect(flow.submit.textContent).toContain("Import account");
  });

  test("a failed check shows the reason and no picker", async () => {
    const flow = mountSettings(() =>
      Promise.reject(new Error("Couldn't check this key's Ready accounts. Try again.")),
    );
    flow.send();
    await tick();
    expect(flow.container.querySelector("[data-ready-key-picker]")).toBeNull();
    expect(flow.container.querySelector("#import-key-result")?.textContent).toBe(
      "Couldn't check this key's Ready accounts. Try again.",
    );
    expect(flow.imports).toEqual([]);
  });
});

describe("isReadyKeyDiscoveryResponse", () => {
  test("accepts public rows only, and at least one", () => {
    expect(isReadyKeyDiscoveryResponse({ candidates: [deployed, dusted], ok: true })).toBe(true);
    for (const response of [
      { candidates: [], ok: true },
      { candidates: [{ ...deployed, privateKey: PASTED_KEY }], ok: true },
      { candidates: [{ ...deployed, holdings: [] }], ok: true },
      { candidates: [{ ...dusted, holdings: [] }], ok: true },
      { candidates: [{ ...deployed, address: "not a felt" }], ok: true },
      { candidates: [deployed], ok: true, privateKey: PASTED_KEY },
    ]) {
      expect(isReadyKeyDiscoveryResponse(response)).toBe(false);
    }
  });
});
