/**
 * The app directory in the side panel (mc-wallet issue 749): the listed-app
 * line on an approval card, the directory screen and its filters, the listed
 * mark and site on Activity rows, and the menu row withheld while no app is
 * listed. Fixtures use reserved example domains.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAppDirectory, type ListedApp } from "@bramble/permissions/app-directory";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  type PendingApproval,
  readPendingApprovals,
  type WalletStatus,
} from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import { bindAppDirectory } from "../../../../src/sidepanel/journeys/apps/app-directory-ui";
import {
  appDirectoryFlow,
  hasListedApps,
} from "../../../../src/sidepanel/journeys/apps/app-directory-view";
import {
  activityListedMark,
  activityRecordFacts,
} from "../../../../src/sidepanel/journeys/portfolio/activity-detail";
import { transactionRow } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { settingsScreen } from "../../../../src/sidepanel/journeys/settings/settings-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

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

const app = (overrides: Partial<ListedApp>): ListedApp => ({
  audit: "https://audits.example.org/report.pdf",
  category: "defi",
  chains: { SN_MAIN: { contracts: ["0x123"] } },
  id: "example-dex",
  name: "Example DEX",
  origin: "https://app.example.com",
  ...overrides,
});

const directory = createAppDirectory(
  [
    app({}),
    app({ category: "gaming", id: "arena", name: "Arena", origin: "https://arena.example.org" }),
    app({
      chains: { SN_SEPOLIA: { contracts: ["0x1"] } },
      id: "testnet-only",
      name: "Testnet Only",
      origin: "https://test.example.net",
    }),
  ],
  ["https://old.example.com"],
);

const CONNECT_ID = "d81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
const connect = (overrides: Partial<PendingApproval> = {}): PendingApproval => ({
  id: CONNECT_ID,
  kind: "connect",
  origin: "https://app.example.com",
  ...overrides,
});

const row: ActivityEntry = {
  accountId: "account-1",
  hash: "0x123",
  kind: "invoke",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "accepted",
  submittedAt: 1752501900000,
  summary: "https://app.example.com submitted 1 call",
};

const render = (html: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

describe("approval card listing", () => {
  test("a listed request shows its listed name under the site", () => {
    const html = dashboard("activity", status, [connect({ listing: "Example DEX" })], preferences, {
      balances: [],
    });
    expect(render(html).querySelector(".request-listed")?.textContent).toBe(
      "Listed app: Example DEX",
    );
  });

  test("an unlisted request shows no listing line", () => {
    const html = dashboard("activity", status, [connect()], preferences, { balances: [] });
    expect(html).not.toContain("request-listed");
  });

  test("the listed name is escaped", () => {
    const html = dashboard("activity", status, [connect({ listing: "<b>x</b>" })], preferences, {
      balances: [],
    });
    expect(html).toContain("Listed app: &lt;b&gt;x&lt;/b&gt;");
  });

  test("the panel accepts a listing within the name cap and drops one past it", () => {
    expect(
      readPendingApprovals({ ok: true, pending: [connect({ listing: "Example DEX" })] }),
    ).toHaveLength(1);
    expect(
      readPendingApprovals({ ok: true, pending: [connect({ listing: "x".repeat(41) })] }),
    ).toEqual([]);
    expect(
      readPendingApprovals({
        ok: true,
        pending: [{ ...connect(), listing: 7 } as unknown as PendingApproval],
      }),
    ).toEqual([]);
  });
});

describe("app directory screen", () => {
  test("lists the active network's apps by name, each opening its origin in a new tab", () => {
    const root = render(appDirectoryFlow(status, [], directory));
    const links = [...root.querySelectorAll<HTMLAnchorElement>("a.app-entry")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://arena.example.org",
      "https://app.example.com",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(root.textContent).not.toContain("Testnet Only");
    expect(root.querySelector(".flow-title p")?.textContent).toBe("2 listed");
  });

  test("offers only the categories present", () => {
    const root = render(appDirectoryFlow(status, [], directory));
    expect(
      [...root.querySelectorAll<HTMLOptionElement>('select[name="app-category"] option')].map(
        (option) => option.value,
      ),
    ).toEqual(["", "defi", "gaming"]);
  });

  test("marks connected apps once the connected-sites read has landed, and none before", () => {
    const sites = [{ accountCount: 1, origin: "https://app.example.com" }];
    expect(
      render(appDirectoryFlow(status, sites, directory)).querySelectorAll(".app-connected"),
    ).toHaveLength(1);
    expect(appDirectoryFlow(status, "loading", directory)).not.toContain("app-connected");
    expect(appDirectoryFlow(status, "error", directory)).not.toContain("app-connected");
  });

  test("a network with no listed app shows the empty state and no filters", () => {
    const html = appDirectoryFlow({ ...status, networkId: "SN_DEVNET" }, [], directory);
    expect(html).toContain("No apps are listed for this network yet.");
    expect(html).not.toContain("app-search");
  });

  test("search and category narrow the list, and an empty result says so", () => {
    const root = render(appDirectoryFlow(status, [], directory));
    bindAppDirectory(root);
    const search = root.querySelector<HTMLInputElement>('input[name="app-search"]');
    const category = root.querySelector<HTMLSelectElement>('select[name="app-category"]');
    const none = root.querySelector<HTMLElement>("[data-app-none]");
    const visible = (): string[] =>
      [...root.querySelectorAll<HTMLElement>("[data-app-row]")]
        .filter((item) => !item.hidden)
        .map((item) => item.querySelector("strong")?.textContent ?? "");
    if (!search || !category || !none) throw new Error("controls missing");

    search.value = "ARENA";
    search.dispatchEvent(new Event("input"));
    expect(visible()).toEqual(["Arena"]);

    search.value = "example.com";
    search.dispatchEvent(new Event("input"));
    expect(visible()).toEqual(["Example DEX"]);

    search.value = "";
    search.dispatchEvent(new Event("input"));
    category.value = "gaming";
    category.dispatchEvent(new Event("change"));
    expect(visible()).toEqual(["Arena"]);
    expect(none.hidden).toBe(true);

    search.value = "nothing";
    search.dispatchEvent(new Event("input"));
    expect(visible()).toEqual([]);
    expect(none.hidden).toBe(false);
  });

  test("binding a screen without the directory is a no-op", () => {
    expect(() => bindAppDirectory(render("<p></p>"))).not.toThrow();
    expect(() => bindAppDirectory(null)).not.toThrow();
  });
});

describe("menu row", () => {
  test("is withheld while the bundled directory lists nothing", () => {
    expect(hasListedApps("SN_MAIN")).toBe(false);
    expect(settingsScreen(status, preferences)).not.toContain('data-view="apps"');
  });

  test("is offered for a network with a listed app", () => {
    expect(hasListedApps("SN_MAIN", directory)).toBe(true);
    expect(hasListedApps("SN_DEVNET", directory)).toBe(false);
  });
});

describe("activity rows", () => {
  test("a listed app's row carries the listed mark and its site with the listed name", () => {
    const entry = { ...row, dappOrigin: "https://app.example.com" };
    expect(activityListedMark(entry, directory)).toContain("Listed app: Example DEX");
    const facts = render(`<dl>${activityRecordFacts(entry, [], directory)}</dl>`);
    expect(facts.querySelector("dd")?.textContent).toBe(
      "https://app.example.comListed app: Example DEX",
    );
  });

  test("an unlisted site is shown without a mark", () => {
    const entry = { ...row, dappOrigin: "https://other.example.com" };
    expect(activityListedMark(entry, directory)).toBe("");
    expect(activityRecordFacts(entry, [], directory)).toContain("https://other.example.com");
    expect(activityRecordFacts(entry, [], directory)).not.toContain("Listed app");
  });

  test("a delisted site loses the mark on past rows", () => {
    const delisted = createAppDirectory([], ["https://app.example.com"]);
    const entry = { ...row, dappOrigin: "https://app.example.com" };
    expect(activityListedMark(entry, delisted)).toBe("");
    expect(activityRecordFacts(entry, [], delisted)).not.toContain("Listed app");
  });

  test("a row with only the origin in its summary, as legacy rows have, gets no site or mark", () => {
    expect(activityListedMark(row, directory)).toBe("");
    expect(activityRecordFacts(row, [], directory)).not.toContain("Site");
  });

  test("the rendered row shows the recorded site in its expansion", () => {
    const html = transactionRow({ ...row, dappOrigin: "https://other.example.com" });
    const site = [...render(html).querySelectorAll(".disclosure-body dt")].find(
      (term) => term.textContent === "Site",
    );
    expect(site?.nextElementSibling?.textContent).toBe("https://other.example.com");
  });
});
