/**
 * Surface gating for the shared Ledger onboarding entry. Every Ledger operation
 * opens a focused browser tab to reach Chrome's device chooser, and a toolbar
 * popup closes when it loses focus, so a flow begun in the popup cannot finish.
 * Both entry points must therefore refuse to start there, explain why, and offer
 * the switch — and the first-run passphrase must never be captured on a surface
 * that cannot complete the setup it was captured for.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { createLedgerOnboardEntry } from "../../../../src/sidepanel/journeys/ledger/onboard-entry";
import type { LedgerConnector } from "../../../../src/sidepanel/journeys/ledger/sign-session";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
afterEach(() => {
  document.body.className = "";
  document.body.replaceChildren();
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// The connector must never be reached on the popup surface; a stub that throws
// makes any attempt to start the device flow a test failure rather than a
// silently swallowed rejection.
const hostileConnector = {
  connect: () => {
    throw new Error("the device must not be reached from the popup surface");
  },
} as unknown as LedgerConnector;

const mountEntry = (surface: "popup" | "side-panel") => {
  document.body.className = surface === "popup" ? "popup-surface" : "";
  const mount = document.createElement("div");
  document.body.append(mount);
  const displays: Array<{ readonly approvalSurface?: string }> = [];
  const entry = createLedgerOnboardEntry({
    addHd: () => Promise.resolve(),
    cache: emptyRenderCache(),
    connector: hostileConnector,
    mount,
    openImport: () => undefined,
    openImportSeed: () => undefined,
    openMultisig: () => undefined,
    refresh: () => Promise.resolve(),
    wallet: {
      setDisplay: (value: { readonly approvalSurface?: string }) => {
        displays.push(value);
        return Promise.resolve();
      },
    } as unknown as SidepanelWallet,
  });
  return { displays, entry, mount };
};

describe("Ledger surface gating", () => {
  test("refuses to start add-account in the popup and explains why", () => {
    const { entry, mount } = mountEntry("popup");
    entry.startAddAccount();
    expect(mount.hidden).toBe(false);
    expect(mount.textContent).toContain("Ledger needs the side panel");
    expect(mount.textContent).not.toContain("Add a new account");
  });

  test("refuses to start first-run setup in the popup", () => {
    const { entry, mount } = mountEntry("popup");
    // If this captured the passphrase and started the runtime, the hostile
    // connector would throw; refusing before either is the point.
    entry.startLedgerSetup("SN_MAIN", "correct horse battery staple");
    expect(mount.textContent).toContain("Ledger needs the side panel");
  });

  test("switching the surface persists the preference and says what to do next", async () => {
    const { displays, entry, mount } = mountEntry("popup");
    entry.startAddAccount();
    mount.querySelector<HTMLButtonElement>("[data-ledger-surface-switch]")?.click();
    await tick();

    expect(displays).toEqual([{ approvalSurface: "side-panel" }]);
    // The popup cannot raise the side panel itself, so it must not pretend to.
    expect(mount.textContent).toContain("Switched to the side panel");
    expect(mount.textContent).toContain("toolbar");
  });

  test("dismissing the notice clears the overlay", () => {
    const { entry, mount } = mountEntry("popup");
    entry.startAddAccount();
    mount.querySelector<HTMLButtonElement>("[data-ledger-onboard-cancel]")?.click();
    expect(mount.hidden).toBe(true);
    expect(mount.textContent).toBe("");
  });

  test("does not gate the side panel", () => {
    const { entry, mount } = mountEntry("side-panel");
    entry.startAddAccount();
    expect(mount.textContent).not.toContain("Ledger needs the side panel");
    expect(mount.textContent).toContain("Add a new account");
  });
});
