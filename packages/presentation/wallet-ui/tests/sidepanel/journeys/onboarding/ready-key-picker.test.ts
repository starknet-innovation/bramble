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

const mountSettings = (
  discover: (
    networkId: string,
    key: string,
    salt?: string,
  ) => Promise<readonly ReadyKeyCandidate[]>,
) => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  container.replaceChildren(document.createRange().createContextualFragment(importKeyFlow(status)));
  const imports: Array<readonly string[] | undefined> = [];
  const sent: Array<readonly [string, string, string | undefined]> = [];
  let networkId = "SN_MAIN";
  const wallet = {
    discoverReadyKeyAccounts: discover,
    importAccount: (
      network: string,
      key: string,
      _type: string,
      salt?: string,
      classHashes?: readonly string[],
    ) => {
      imports.push(classHashes);
      sent.push([network, key, salt]);
      return Promise.resolve(account.id);
    },
  };
  bindImportKey({
    app: container,
    expandedGroup: () => null,
    networkId: () => networkId,
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
  const salt = form?.querySelector<HTMLInputElement>('input[name="deploymentSalt"]');
  if (!form || !contract || !raw || !submit || !salt) throw new Error("import-key form missing");
  contract.value = "argent";
  contract.dispatchEvent(new window.Event("change"));
  raw.value = PASTED_KEY;
  const send = (): void => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  };
  const edit = (field: "key" | "salt", value: string): void => {
    const target = field === "key" ? raw : salt;
    target.value = value;
    target.dispatchEvent(new window.Event("input"));
  };
  const pickers = (): number => container.querySelectorAll("[data-ready-key-picker]").length;
  const switchNetwork = (id: string): void => {
    networkId = id;
  };
  return { container, edit, imports, pickers, raw, salt, send, sent, submit, switchNetwork };
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

const deferred = () => {
  let resolve: (value: readonly ReadyKeyCandidate[]) => void = () => undefined;
  const promise = new Promise<readonly ReadyKeyCandidate[]>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe("Settings → Import private key, stale lists", () => {
  for (const input of ["key", "salt"] as const) {
    test(`a ${input} edited during the check drops the late answer`, async () => {
      const answer = deferred();
      const flow = mountSettings(() => answer.promise);
      flow.send();
      flow.edit(input, "0xbeef");
      expect(flow.submit.disabled).toBe(false);
      answer.resolve([deployed]);
      await tick();
      expect(flow.pickers()).toBe(0);
      expect(flow.submit.textContent).toContain("Import account");
      // The next submit lists the accounts again rather than importing.
      flow.send();
      await tick();
      expect(flow.imports).toEqual([]);
    });
  }

  test("a network switched during the check drops the late answer", async () => {
    const answer = deferred();
    const flow = mountSettings(() => answer.promise);
    flow.send();
    flow.switchNetwork("SN_SEPOLIA");
    answer.resolve([deployed]);
    await tick();
    expect(flow.pickers()).toBe(0);
    expect(flow.submit.disabled).toBe(false);
    expect(flow.submit.textContent).toContain("Import account");
  });

  test("out of order: only the answer for the current inputs is shown", async () => {
    const answers = [deferred(), deferred()];
    const asked: Array<string | undefined> = [];
    const flow = mountSettings((_network, _key, salt) => {
      asked.push(salt);
      const answer = answers[asked.length - 1];
      if (!answer) throw new Error("unexpected discovery");
      return answer.promise;
    });
    flow.send();
    flow.edit("salt", "0x777");
    flow.send();
    answers[1]?.resolve([dusted]);
    await tick();
    answers[0]?.resolve([deployed]);
    await tick();
    expect(asked).toEqual([undefined, "0x777"]);
    expect(flow.pickers()).toBe(1);
    expect(boxes(flow.container).map((box) => box.dataset["readyKeyClass"])).toEqual([ARGENT_030]);
  });

  test("a network switched after listing lists again instead of importing", async () => {
    const asked: string[] = [];
    const flow = mountSettings((network) => {
      asked.push(network);
      return Promise.resolve([deployed]);
    });
    flow.send();
    await tick();
    flow.switchNetwork("SN_SEPOLIA");
    flow.send();
    await tick();
    expect(flow.imports).toEqual([]);
    expect(asked).toEqual(["SN_MAIN", "SN_SEPOLIA"]);
    expect(flow.pickers()).toBe(1);
    flow.send();
    await tick();
    expect(flow.sent).toEqual([["SN_SEPOLIA", PASTED_KEY, undefined]]);
  });

  test("a value changed without an input event still refuses the old ticks", async () => {
    const flow = mountSettings(() => Promise.resolve([deployed]));
    flow.send();
    await tick();
    flow.raw.value = "0xbeef";
    flow.send();
    await tick();
    expect(flow.imports).toEqual([]);
    expect(flow.pickers()).toBe(1);
    flow.send();
    await tick();
    expect(flow.sent).toEqual([["SN_MAIN", "0xbeef", undefined]]);
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
