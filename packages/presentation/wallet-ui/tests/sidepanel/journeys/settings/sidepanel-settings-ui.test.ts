/**
 * Behavioural coverage for settings mutations. Each binding is driven through
 * real DOM events so success, rejection, validation, and rerender behavior stay
 * documented without weakening the aggregate coverage gate.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import {
  bindAccountLabel,
  bindAddAccount,
  bindAppearance,
  bindBackup,
  bindContacts,
  bindGroups,
  type SettingsUiDeps,
} from "../../../../src/sidepanel/journeys/settings/settings-ui";
import { emptyStatus, type SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (html: string, wallet: Partial<SidepanelWallet>) => {
  const app = document.createElement("div");
  app.innerHTML = html;
  document.body.append(app);
  const calls = { add: 0, render: 0 };
  const deps: SettingsUiDeps = {
    app,
    expandedGroup: () => null,
    networkId: () => "SN_MAIN",
    refresh: async () => emptyStatus(),
    render: async () => {
      calls.render += 1;
    },
    setExpandedGroup: () => undefined,
    startAddAccount: () => {
      calls.add += 1;
    },
    wallet: wallet as SidepanelWallet,
  };
  return { app, calls, deps };
};

describe("settings UI bindings", () => {
  test("saves and clears the name of the account whose row was submitted", async () => {
    const updates: Array<readonly [string, string]> = [];
    const { app, calls, deps } = mount(
      `<form data-account-name-form="SN_MAIN:0x1"><input name="label" value=" Daily " /><button type="submit">Save</button></form>
       <form data-account-name-form="SN_MAIN:0x2"><input name="label" value="Savings" /><button type="submit">Save</button></form>
       <p id="label-result"></p>`,
      {
        setAccountLabel: async (accountId, label) => {
          updates.push([accountId, label]);
        },
      },
    );
    bindAccountLabel(deps);

    const first = app.querySelector<HTMLFormElement>('[data-account-name-form="SN_MAIN:0x1"]');
    first?.requestSubmit();
    await tick();

    expect(updates).toEqual([["SN_MAIN:0x1", "Daily"]]);
    expect(calls.render).toBe(1);

    // The second row writes its own account, not whichever one is active: every
    // account on the screen is renameable and they must not cross.
    app.querySelector<HTMLFormElement>('[data-account-name-form="SN_MAIN:0x2"]')?.requestSubmit();
    await tick();
    expect(updates[1]).toEqual(["SN_MAIN:0x2", "Savings"]);

    const input = first?.querySelector<HTMLInputElement>('input[name="label"]');
    if (input) {
      input.value = " ";
    }
    first?.requestSubmit();
    await tick();
    expect(updates[2]).toEqual(["SN_MAIN:0x1", ""]);
  });

  test("fails closed without an account id and restores the row after rejection", async () => {
    let calls = 0;
    // A row that names no account writes nothing: the id comes from the form, so
    // a malformed one can never fall back to renaming some other account.
    const noAccount = mount(
      '<form data-account-name-form=""><input name="label" value="Daily" /><button type="submit">Save</button></form>',
      {
        setAccountLabel: async () => {
          calls += 1;
        },
      },
    );
    bindAccountLabel(noAccount.deps);
    noAccount.app.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await tick();
    expect(calls).toBe(0);

    const rejected = mount(
      '<form data-account-name-form="SN_MAIN:0x1"><input name="label" value="Daily" /><button type="submit">Save</button></form><p id="label-result"></p>',
      {
        setAccountLabel: async () => {
          throw new Error("Label service unavailable");
        },
      },
    );
    bindAccountLabel(rejected.deps);
    rejected.app.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await tick();

    expect(rejected.app.querySelector("#label-result")?.textContent).toBe(
      "Label service unavailable",
    );
    expect(rejected.app.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
  });

  test("opens the add-account chooser and safely binds an empty groups surface", () => {
    const { app, calls, deps } = mount('<button id="new-account">Add</button>', {});
    bindAddAccount(deps);
    bindGroups(deps);

    app.querySelector<HTMLButtonElement>("#new-account")?.click();
    expect(calls.add).toBe(1);
  });

  test("removes contacts, ignores empty ids, and recovers from rejection", async () => {
    const removed: string[] = [];
    const success = mount(
      '<button data-remove-address="">Empty</button><button data-remove-address="friend">Remove</button>',
      {
        removeAddress: async (id) => {
          removed.push(id);
        },
      },
    );
    bindContacts(success.deps);
    success.app.querySelector<HTMLButtonElement>('[data-remove-address=""]')?.click();
    success.app.querySelector<HTMLButtonElement>('[data-remove-address="friend"]')?.click();
    await tick();

    expect(removed).toEqual(["friend"]);
    expect(success.calls.render).toBe(1);

    const rejected = mount('<button data-remove-address="friend">Remove</button>', {
      removeAddress: async () => {
        throw new Error("Contact service unavailable");
      },
    });
    bindContacts(rejected.deps);
    const button = rejected.app.querySelector<HTMLButtonElement>("button");
    button?.click();
    await tick();
    expect(button?.disabled).toBe(false);
  });

  test("persists every valid display preference and ignores invalid or selected rows", async () => {
    const updates: unknown[] = [];
    const { app, calls, deps } = mount(
      `<button data-approval-surface="side-panel" aria-pressed="false">Panel</button>
       <button data-approval-surface="other" aria-pressed="false">Invalid</button>
       <button data-theme-id="light" aria-pressed="false">Light</button>
       <button data-theme-id="dark" aria-pressed="true">Selected</button>
       <select id="currency-select"><option value="eur" selected>EUR</option></select>
       <input id="product-analytics" type="checkbox" checked />
       <input id="reliability-diagnostics" type="checkbox" checked />
       <p id="display-result"></p>`,
      {
        setDisplay: async (input) => {
          updates.push(input);
        },
      },
    );
    bindAppearance(deps);

    app.querySelector<HTMLButtonElement>('[data-approval-surface="side-panel"]')?.click();
    app.querySelector<HTMLButtonElement>('[data-approval-surface="other"]')?.click();
    app.querySelector<HTMLButtonElement>('[data-theme-id="light"]')?.click();
    app.querySelector<HTMLButtonElement>('[data-theme-id="dark"]')?.click();
    app.querySelector<HTMLSelectElement>("#currency-select")?.dispatchEvent(new Event("change"));
    app.querySelector<HTMLInputElement>("#product-analytics")?.dispatchEvent(new Event("change"));
    app
      .querySelector<HTMLInputElement>("#reliability-diagnostics")
      ?.dispatchEvent(new Event("change"));
    await tick();

    expect(updates).toEqual([
      { approvalSurface: "side-panel" },
      { theme: "light" },
      { displayCurrency: "eur" },
      { productAnalytics: true },
      { reliabilityDiagnostics: true },
    ]);
    expect(calls.render).toBe(5);
  });

  test("restores display controls when each preference mutation rejects", async () => {
    const { app, deps } = mount(
      `<button data-approval-surface="popup" aria-pressed="false">Popup</button>
       <button data-theme-id="dark" aria-pressed="false">Dark</button>
       <select id="currency-select"><option value="gbp" selected>GBP</option></select>
       <input id="product-analytics" type="checkbox" checked />
       <input id="reliability-diagnostics" type="checkbox" checked />
       <p id="display-result"></p>`,
      {
        setDisplay: async () => {
          throw new Error("Display service unavailable");
        },
      },
    );
    bindAppearance(deps);

    const approval = app.querySelector<HTMLButtonElement>("[data-approval-surface]");
    const theme = app.querySelector<HTMLButtonElement>("[data-theme-id]");
    const currency = app.querySelector<HTMLSelectElement>("#currency-select");
    const analytics = app.querySelector<HTMLInputElement>("#product-analytics");
    const diagnostics = app.querySelector<HTMLInputElement>("#reliability-diagnostics");
    approval?.click();
    theme?.click();
    currency?.dispatchEvent(new Event("change"));
    if (analytics) analytics.checked = false;
    analytics?.dispatchEvent(new Event("change"));
    if (diagnostics) diagnostics.checked = false;
    diagnostics?.dispatchEvent(new Event("change"));
    await tick();

    expect(approval?.disabled).toBe(false);
    expect(theme?.disabled).toBe(false);
    expect(currency?.disabled).toBe(false);
    expect(analytics?.checked).toBe(true);
    expect(analytics?.disabled).toBe(false);
    expect(diagnostics?.checked).toBe(true);
    expect(diagnostics?.disabled).toBe(false);
    expect(app.querySelector("#display-result")?.textContent).toBe("Display service unavailable");
  });

  test("exports and imports a non-secret preferences backup", async () => {
    let imported: unknown;
    let downloaded = 0;
    let revoked = "";
    const { app, calls, deps } = mount(
      '<button id="backup-export">Export</button><input id="backup-file" type="file" /><button id="backup-import">Import</button><p id="backup-result"></p>',
      {
        importPreferences: async (value) => {
          imported = value;
        },
        // A contact in the stored preferences must not reach the file
        // (Sherlock 213): a restore never brings it back.
        loadPreferences: async () => ({
          ...defaultWalletPreferences(),
          addressBook: [
            { address: "0x123", id: "SN_MAIN:0x123", label: "Ada", networkId: "SN_MAIN" },
          ],
          displayCurrency: "usd",
        }),
      },
    );
    const input = app.querySelector<HTMLInputElement>("#backup-file");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(['{"displayCurrency":"eur"}'], "backup.json", { type: "application/json" })],
    });

    const createObjectUrl = URL.createObjectURL;
    const revokeObjectUrl = URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    const schedule = globalThis.setTimeout;
    let exported: Blob | null = null;
    URL.createObjectURL = (blob) => {
      exported = blob as Blob;
      return "blob:wallet-backup";
    };
    URL.revokeObjectURL = (url) => {
      revoked = String(url);
    };
    HTMLAnchorElement.prototype.click = () => {
      downloaded += 1;
    };
    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 0;
    }) as typeof setTimeout;

    try {
      bindBackup(deps);
      app.querySelector<HTMLButtonElement>("#backup-export")?.click();
      app.querySelector<HTMLButtonElement>("#backup-import")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise<void>((resolve) => schedule(resolve, 0));
    } finally {
      URL.createObjectURL = createObjectUrl;
      URL.revokeObjectURL = revokeObjectUrl;
      HTMLAnchorElement.prototype.click = click;
      globalThis.setTimeout = schedule;
    }

    expect(downloaded).toBe(1);
    expect(revoked).toBe("blob:wallet-backup");
    const file = JSON.parse(await (exported as unknown as Blob).text()) as Record<string, unknown>;
    expect(file["addressBook"]).toEqual([]);
    expect(file["displayCurrency"]).toBe("usd");
    expect(imported).toEqual({ displayCurrency: "eur" });
    expect(calls.render).toBe(1);
  });

  test("handles missing, malformed, and unavailable backup data", async () => {
    const { app, deps } = mount(
      '<button id="backup-export">Export</button><input id="backup-file" type="file" /><button id="backup-import">Import</button><p id="backup-result"></p>',
      {
        importPreferences: async () => undefined,
        loadPreferences: async () => {
          throw new Error("Backup service unavailable");
        },
      },
    );
    bindBackup(deps);
    const exportButton = app.querySelector<HTMLButtonElement>("#backup-export");
    const importButton = app.querySelector<HTMLButtonElement>("#backup-import");
    exportButton?.click();
    importButton?.click();
    await tick();
    expect(exportButton?.disabled).toBe(false);

    Object.defineProperty(app.querySelector<HTMLInputElement>("#backup-file"), "files", {
      configurable: true,
      value: [new File(["not json"], "broken.json", { type: "application/json" })],
    });
    importButton?.click();
    await tick();
    expect(importButton?.disabled).toBe(false);
    expect(app.querySelector("#backup-result")?.textContent).not.toBe("");
  });
});
