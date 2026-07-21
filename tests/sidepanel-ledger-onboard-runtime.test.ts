/**
 * Behavioural coverage for the DOM-bound Ledger onboarding runtime under
 * happy-dom, driven with an injected fake connector and wallet: the in-shell
 * trigger opens the connect prompt, connect enumerates and renders the picker,
 * and selecting a candidate creates the keyless account and dismisses the
 * overlay. No WebHID or background is touched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "../src/sidepanel/ledger/client";
import { createLedgerOnboardRuntime } from "../src/sidepanel/ledger/onboard-runtime";
import type { LedgerConnector } from "../src/sidepanel/ledger/sign-session";
import { ledgerAccountPath } from "../src/starknet/ledger-path";
import type { LedgerAccountRef } from "../src/storage/vault-schema";
import { registerDom, unregisterDom } from "./support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

const mountRuntime = () => {
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
  const connector: LedgerConnector = {
    openConnected: () => Promise.resolve(null),
    request: () => Promise.resolve({ client: enumerateClient, close: () => Promise.resolve() }),
  };
  const networkId = () => "SN_MAIN";
  const runtime = createLedgerOnboardRuntime({
    connector,
    create: (accountIndex, publicKeyX) => {
      added.push([networkId(), accountIndex, publicKeyX]);
      return Promise.resolve();
    },
    describe: () => Promise.resolve({ balance: null, deployed: null }),
    existingIds: () => new Set<string>(),
    mount,
    networkId,
    onCancel: () => {
      cancels += 1;
    },
    refresh: () => {
      refreshed += 1;
      return Promise.resolve();
    },
    wallet: {
      deriveLedgerAccounts: () => Promise.resolve([candidate(0), candidate(1)]),
    },
  });
  runtime.bindTriggers(app);
  return { added, app, cancels: () => cancels, mount, refreshed: () => refreshed, runtime };
};

const click = (root: ParentNode, selector: string): void => {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`missing ${selector}`);
  }
  button.dispatchEvent(new window.Event("click", { bubbles: true }));
};

describe("Ledger onboarding runtime (DOM)", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("the trigger opens connect, connect renders the picker, select creates", async () => {
    const h = mountRuntime();
    click(h.app, "[data-connect-ledger]");
    expect(h.mount.hidden).toBe(false);
    expect(h.mount.querySelector("[data-ledger-onboard-connect]")).not.toBeNull();

    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();
    // Picker rendered with both enumerated candidates.
    expect(h.mount.querySelectorAll("[data-ledger-select]").length).toBe(2);

    click(h.mount, '[data-ledger-select="1"]');
    await tick();
    expect(h.added).toEqual([["SN_MAIN", 1, candidate(1).publicKeyX]]);
    expect(h.mount.hidden).toBe(true);
    expect(h.refreshed()).toBe(1);
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
    // The overlay is dismissed (returning to the screen behind it) and the
    // onCancel hook fired.
    expect(h.mount.hidden).toBe(true);
    expect(h.mount.children.length).toBe(0);
    expect(h.cancels()).toBe(1);
  });

  test("the picker stage is dismissable via its cancel control", async () => {
    const h = mountRuntime();
    click(h.app, "[data-connect-ledger]");
    click(h.mount, "[data-ledger-onboard-connect]");
    await tick();
    // Picker is showing with a reachable cancel control alongside the candidates.
    expect(h.mount.querySelectorAll("[data-ledger-select]").length).toBe(2);
    expect(h.mount.querySelector("[data-ledger-onboard-cancel]")).not.toBeNull();

    click(h.mount, "[data-ledger-onboard-cancel]");
    expect(h.mount.hidden).toBe(true);
    expect(h.added).toEqual([]);
    expect(h.cancels()).toBe(1);
  });
});
