/**
 * Behavioural coverage for the DOM-bound Ledger onboarding runtime under
 * happy-dom, driven with an injected fake connector and wallet: the in-shell
 * trigger opens the connect prompt, connect enumerates and renders the
 * multi-select picker, "Show more" appends the next page of indices, selecting
 * candidates and "Add selected" creates exactly those keyless accounts and
 * dismisses the overlay, and the add-account chooser routes each option to its
 * flow. No WebHID or background is touched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@mc-wallet/ledger-protocol/client";
import type { LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import {
  createLedgerOnboardRuntime,
  type LedgerOnboardRuntimeDeps,
} from "../../../../src/sidepanel/journeys/ledger/onboard-runtime";
import type { LedgerConnector } from "../../../../src/sidepanel/journeys/ledger/sign-session";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// A device whose pubkey per index is deterministic, so distinct indices produce
// distinct entries and a page reads exactly its slice of indices.
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
  getPubKey: (path: string) => {
    const index = Number(path.split("/").at(-1)?.replace(/'.*$/, "") ?? "0");
    return Promise.resolve({
      errorMessage: "No errors",
      publicKey: new Uint8Array([...new Array(31).fill(0), index + 1, ...new Array(32).fill(0)]),
      returnCode: 0x9000,
    });
  },
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

const mountRuntime = (overrides: Partial<LedgerOnboardRuntimeDeps> = {}) => {
  document.body.replaceChildren();
  const mount = document.createElement("div");
  mount.hidden = true;
  document.body.append(mount);
  const app = document.createElement("div");
  const trigger = document.createElement("button");
  trigger.setAttribute("data-connect-ledger", "");
  app.append(trigger);
  document.body.append(app);
  const added: Array<readonly [string, number, string]> = [];
  let refreshed = 0;
  let cancels = 0;
  let hdAdds = 0;
  let imports = 0;
  let multisigs = 0;
  const connector: LedgerConnector = {
    openConnected: () => Promise.resolve(null),
    request: () => Promise.resolve({ client: enumerateClient, close: () => Promise.resolve() }),
  };
  const runtime = createLedgerOnboardRuntime({
    addHd: () => {
      hdAdds += 1;
      return Promise.resolve();
    },
    connector,
    create: (account) => {
      added.push([account.networkId, account.derivation.accountIndex, account.publicKeyX]);
      return Promise.resolve();
    },
    describe: () => Promise.resolve({ balance: null, deployed: null }),
    existingIds: () => new Set<string>(),
    mount,
    networkId: () => "SN_MAIN",
    onCancel: () => {
      cancels += 1;
    },
    openImport: () => {
      imports += 1;
    },
    openMultisig: () => {
      multisigs += 1;
    },
    refresh: () => {
      refreshed += 1;
      return Promise.resolve();
    },
    wallet: {
      deriveLedgerAccounts: (_networkId, entries) =>
        Promise.resolve(entries.map((entry) => candidate(entry.accountIndex))),
    },
    ...overrides,
  });
  runtime.bindTriggers(app);
  return {
    added,
    app,
    cancels: () => cancels,
    hdAdds: () => hdAdds,
    imports: () => imports,
    multisigs: () => multisigs,
    mount,
    refreshed: () => refreshed,
    runtime,
  };
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

const toggleCount = (root: ParentNode): number =>
  root.querySelectorAll("[data-ledger-toggle]").length;

describe("Ledger onboarding runtime (DOM)", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("the trigger opens connect, connect renders a page, add-selected creates", async () => {
    const h = mountRuntime();
    click(h.app, "[data-connect-ledger]");
    expect(h.mount.hidden).toBe(false);
    expect(h.mount.querySelector("[data-ledger-onboard-connect]")).not.toBeNull();

    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();
    // One page (5) of selectable candidates rendered.
    expect(toggleCount(h.mount)).toBe(5);

    check(h.mount, '[data-ledger-toggle="1"]');
    click(h.mount, "[data-ledger-add-selected]");
    await tick();
    expect(h.added).toEqual([["SN_MAIN", 1, candidate(1).publicKeyX]]);
    expect(h.mount.hidden).toBe(true);
    expect(h.refreshed()).toBe(1);
  });

  test('"Show more" appends the next page of indexes (5-9) without refetching', async () => {
    let requests = 0;
    let reconnects = 0;
    const connector: LedgerConnector = {
      openConnected: () => {
        reconnects += 1;
        return Promise.resolve({ client: enumerateClient, close: () => Promise.resolve() });
      },
      request: () => {
        requests += 1;
        return Promise.resolve({ client: enumerateClient, close: () => Promise.resolve() });
      },
    };
    const h = mountRuntime({ connector });
    click(h.app, "[data-connect-ledger]");
    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();
    expect(toggleCount(h.mount)).toBe(5);
    expect(h.mount.querySelector('[data-ledger-toggle="4"]')).not.toBeNull();
    expect(h.mount.querySelector('[data-ledger-toggle="5"]')).toBeNull();

    click(h.mount, "[data-ledger-load-more]");
    await tick();
    // Page 2 (indexes 5-9) is appended to the existing page (indexes 0-4).
    expect(toggleCount(h.mount)).toBe(10);
    for (let index = 5; index <= 9; index += 1) {
      expect(h.mount.querySelector(`[data-ledger-toggle="${index}"]`)).not.toBeNull();
    }
    // The first page used the gesture-gated picker; "Show more" reconnected the
    // already-granted device silently rather than prompting again.
    expect(requests).toBe(1);
    expect(reconnects).toBe(1);
  });

  test("multiple connected devices render a chooser and open the selected device", async () => {
    let openedId: string | undefined;
    const h = mountRuntime({
      connector: {
        listConnected: () =>
          Promise.resolve([
            { id: "first", label: "Ledger Nano X 1" },
            { id: "second", label: "Ledger Nano X 2" },
          ]),
        openConnected: (deviceId) => {
          openedId = deviceId;
          return Promise.resolve({ client: enumerateClient, close: () => Promise.resolve() });
        },
        request: () => Promise.reject(new Error("no picker expected")),
      },
    });
    click(h.app, "[data-connect-ledger]");
    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();

    expect(h.mount.textContent).toContain("Choose your Ledger");
    expect(h.mount.querySelector('[data-ledger-device="second"]')).not.toBeNull();
    expect(openedId).toBeUndefined();

    click(h.mount, '[data-ledger-device="second"]');
    await tick();
    expect(openedId).toBe("second");
    expect(toggleCount(h.mount)).toBe(5);
  });

  test("Add selected adds exactly the checked accounts, in order", async () => {
    const h = mountRuntime();
    click(h.app, "[data-connect-ledger]");
    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();

    check(h.mount, '[data-ledger-toggle="2"]');
    check(h.mount, '[data-ledger-toggle="0"]');
    click(h.mount, "[data-ledger-add-selected]");
    await tick();
    expect(h.added).toEqual([
      ["SN_MAIN", 0, candidate(0).publicKeyX],
      ["SN_MAIN", 2, candidate(2).publicKeyX],
    ]);
    expect(h.mount.hidden).toBe(true);
  });

  test("start() opens the connect overlay directly", () => {
    const h = mountRuntime();
    h.runtime.start();
    expect(h.mount.hidden).toBe(false);
    expect(h.mount.textContent).toContain("Connect a Ledger");
  });

  test("the connect state renders a cancel control that tears down the overlay", () => {
    const h = mountRuntime();
    h.runtime.start();
    const cancel = h.mount.querySelector<HTMLButtonElement>("[data-ledger-onboard-cancel]");
    expect(cancel).not.toBeNull();

    click(h.mount, "[data-ledger-onboard-cancel]");
    expect(h.mount.hidden).toBe(true);
    expect(h.mount.children.length).toBe(0);
    expect(h.cancels()).toBe(1);
  });

  test("the picker stage is dismissable via its cancel control", async () => {
    const h = mountRuntime();
    click(h.app, "[data-connect-ledger]");
    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();
    expect(toggleCount(h.mount)).toBe(5);
    expect(h.mount.querySelector("[data-ledger-onboard-cancel]")).not.toBeNull();

    click(h.mount, "[data-ledger-onboard-cancel]");
    expect(h.mount.hidden).toBe(true);
    expect(h.added).toEqual([]);
    expect(h.cancels()).toBe(1);
  });

  test("startAddAccount shows the chooser and routes each option", async () => {
    const h = mountRuntime();
    h.runtime.startAddAccount();
    expect(h.mount.hidden).toBe(false);
    expect(h.mount.querySelector('[data-add-kind="hd"]')).not.toBeNull();
    expect(h.mount.querySelector('[data-add-kind="import"]')).not.toBeNull();
    expect(h.mount.querySelector('[data-add-kind="ledger"]')).not.toBeNull();

    expect(h.mount.querySelector('[data-add-kind="multisig"]')).not.toBeNull();

    // Selection stays reversible until Continue confirms the route.
    click(h.mount, '[data-add-kind="ledger"]');
    expect(h.mount.querySelector("[data-ledger-onboard-connect]")).toBeNull();
    click(h.mount, "[data-add-continue]");
    expect(h.mount.querySelector("[data-ledger-onboard-connect]")).not.toBeNull();

    // "Import a private key" dismisses the overlay and routes to the import form.
    h.runtime.startAddAccount();
    click(h.mount, '[data-add-kind="import"]');
    click(h.mount, "[data-add-continue]");
    expect(h.mount.hidden).toBe(true);
    expect(h.imports()).toBe(1);

    // "New account" derives an HD account, then dismisses on success.
    h.runtime.startAddAccount();
    click(h.mount, '[data-add-kind="hd"]');
    click(h.mount, "[data-add-continue]");
    await tick();
    expect(h.hdAdds()).toBe(1);
    expect(h.mount.hidden).toBe(true);
    expect(h.refreshed()).toBe(1);

    h.runtime.startAddAccount();
    click(h.mount, '[data-add-kind="multisig"]');
    click(h.mount, "[data-add-continue]");
    expect(h.mount.hidden).toBe(true);
    expect(h.multisigs()).toBe(1);
  });
});
