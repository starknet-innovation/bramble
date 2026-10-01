/**
 * Send's recipient list groups the user's own accounts under the same folders
 * the account drawer shows, so a recipient is found where it was filed. The
 * archive starts minimized, and a search reaches into it: an address the user
 * is looking for must be findable wherever it sits, otherwise the screen would
 * answer "No matching recipient" for an account the wallet holds.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_GROUP_IDS } from "@bramble/settings/groups";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, secondAccount } from "@bramble/testkit/sidepanel";
import { icon } from "@bramble/ui-kit/icons";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindTransferCompose } from "../../../../src/sidepanel/journeys/send/transfer-compose-ui";
import { SEND_COMPOSE_STYLES } from "../../../../src/sidepanel/styles/send/styles-send-compose";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { paint } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

// secondAccount is filed in the archive; `account` is in no folder, so it shows
// under My accounts without anything having been written for it.
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  groups: [
    { accountIds: [], icon: "briefcase", id: "work", name: "Work" },
    {
      accountIds: [secondAccount.id],
      icon: "folder",
      id: DEFAULT_GROUP_IDS.archived,
      name: "Archived accounts",
    },
  ],
  schemaVersion: 1,
  tokens: [],
};

const mount = (): HTMLFormElement => {
  const app = document.createElement("div");
  app.id = "app";
  paint(app, sendFlow(status, account, preferences, [], {}, {}, "usd", [], null));
  document.body.append(app);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) {
    throw new Error("transfer form missing");
  }
  bindTransferCompose({ form, goTo: () => undefined, onFields: () => undefined });
  return form;
};

const folder = (form: HTMLFormElement, id: string): HTMLElement => {
  const found = form.querySelector<HTMLElement>(`[data-send-folder="${id}"]`);
  if (!found) {
    throw new Error(`folder missing: ${id}`);
  }
  return found;
};

const rowFor = (form: HTMLFormElement, address: string): HTMLElement => {
  const found = form.querySelector<HTMLElement>(`[data-send-recipient="${address}"]`);
  if (!found) {
    throw new Error(`recipient row missing: ${address}`);
  }
  return found;
};

const iconPath = (name: "chevronDown" | "chevronRight"): string => {
  const holder = document.createElement("div");
  holder.innerHTML = icon(name);
  return holder.querySelector("path")?.getAttribute("d") ?? "";
};

const search = (form: HTMLFormElement, value: string): void => {
  const field = form.querySelector<HTMLInputElement>("#send-recipient-search");
  if (!field) {
    throw new Error("search field missing");
  }
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("Send recipient folders", () => {
  test("lists every folder, home first and the archive last", () => {
    const form = mount();

    const ids = [...form.querySelectorAll("[data-send-folder]")].map((section) =>
      section.getAttribute("data-send-folder"),
    );
    // Only folders holding an account are listed, home first and the archive last.
    expect(ids).toEqual([DEFAULT_GROUP_IDS.home, DEFAULT_GROUP_IDS.archived]);
  });

  test("the archive starts minimized and its rows are not listed", () => {
    const form = mount();

    expect(folder(form, DEFAULT_GROUP_IDS.archived).dataset["collapsed"]).toBe("true");
    expect(rowFor(form, secondAccount.address).hasAttribute("hidden")).toBe(true);
    // Every other folder starts open.
    expect(folder(form, DEFAULT_GROUP_IDS.home).dataset["collapsed"]).toBe("false");
    expect(rowFor(form, account.address).hasAttribute("hidden")).toBe(false);
  });

  test("an account in no folder is offered under My accounts", () => {
    const form = mount();

    const home = folder(form, DEFAULT_GROUP_IDS.home);
    expect(home.querySelector(`[data-send-recipient="${account.address}"]`)).not.toBeNull();
    // Nothing was written to put it there.
    expect(preferences.groups?.[0]?.accountIds).toEqual([]);
  });

  test("the folder heading opens and closes its own rows", () => {
    const form = mount();
    const head = folder(form, DEFAULT_GROUP_IDS.archived).querySelector<HTMLButtonElement>(
      "[data-send-folder-toggle]",
    );

    head?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(folder(form, DEFAULT_GROUP_IDS.archived).dataset["collapsed"]).toBe("false");
    expect(head?.getAttribute("aria-expanded")).toBe("true");
    expect(rowFor(form, secondAccount.address).hasAttribute("hidden")).toBe(false);

    head?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(rowFor(form, secondAccount.address).hasAttribute("hidden")).toBe(true);
  });

  test("the folder mark stays a right chevron and the open state rotates it", () => {
    const form = mount();
    const archived = folder(form, DEFAULT_GROUP_IDS.archived);
    const path = archived.querySelector(".send-folder-mark path")?.getAttribute("d");
    const right = iconPath("chevronRight");

    expect(path).toBe(right);
    expect(path).not.toBe(iconPath("chevronDown"));
    archived
      .querySelector("[data-send-folder-toggle]")
      ?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(archived.dataset["collapsed"]).toBe("false");
    // The glyph is not swapped on toggle. Open folders rotate this same mark.
    expect(archived.querySelector(".send-folder-mark path")?.getAttribute("d")).toBe(right);
    expect(SEND_COMPOSE_STYLES).toContain(
      '.send-recipient-folder[data-collapsed="false"] .send-folder-mark { transform: rotate(90deg); }',
    );
  });

  test("a folder holding nothing is not listed at all", () => {
    const app = document.createElement("div");
    app.id = "app";
    const emptyWork: WalletPreferences = {
      ...preferences,
      groups: [{ accountIds: [], icon: "briefcase", id: "work", name: "Work" }],
    };
    paint(app, sendFlow(status, account, emptyWork, [], {}, {}, "usd", [], null));
    document.body.append(app);
    const form = app.querySelector<HTMLFormElement>("#transfer-form");
    if (!form) {
      throw new Error("transfer form missing");
    }
    bindTransferCompose({ form, goTo: () => undefined, onFields: () => undefined });

    // There is nothing to send to inside an empty folder, so it is not offered.
    expect(form.querySelector('[data-send-folder="work"]')).toBeNull();
    expect(form.querySelector("[data-send-folder-empty]")).toBeNull();
  });

  test("a search finds an account inside the minimized archive", () => {
    const form = mount();
    // Without reaching into the collapsed folder this would report no match for
    // an account the wallet holds.
    search(form, secondAccount.address.slice(0, 6));

    expect(rowFor(form, secondAccount.address).hasAttribute("hidden")).toBe(false);
    expect(form.querySelector("#send-recipient-empty")?.hasAttribute("hidden")).toBe(true);
  });

  test("a folder with nothing to show drops out during a search, and returns after", () => {
    const form = mount();
    search(form, secondAccount.address.slice(0, 6));

    // My accounts holds no match for this search; the archive holds the account.
    expect(folder(form, DEFAULT_GROUP_IDS.home).hasAttribute("hidden")).toBe(true);
    expect(folder(form, DEFAULT_GROUP_IDS.archived).hasAttribute("hidden")).toBe(false);

    search(form, "");
    expect(folder(form, DEFAULT_GROUP_IDS.home).hasAttribute("hidden")).toBe(false);
    // Clearing the search re-minimizes the archive rather than leaving it open.
    expect(rowFor(form, secondAccount.address).hasAttribute("hidden")).toBe(true);
  });

  test("choosing a recipient from a folder still records its address", () => {
    const app = document.createElement("div");
    app.id = "app";
    paint(app, sendFlow(status, account, preferences, [], {}, {}, "usd", [], null));
    document.body.append(app);
    const form = app.querySelector<HTMLFormElement>("#transfer-form");
    if (!form) {
      throw new Error("transfer form missing");
    }
    const stages: string[] = [];
    bindTransferCompose({ form, goTo: (stage) => stages.push(stage), onFields: () => undefined });

    rowFor(form, account.address).dispatchEvent(new Event("click", { bubbles: true }));

    expect(form.querySelector<HTMLInputElement>('[name="recipient"]')?.value).toBe(account.address);
    expect(stages).toContain("details");
  });
});
