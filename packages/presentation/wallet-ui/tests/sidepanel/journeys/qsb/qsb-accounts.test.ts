/**
 * The Quantum-safe Bitcoin accounts screen under happy-dom: it is reachable
 * from the account drawer, lists each account with its state (backup needed,
 * ready, read-only, history unavailable), offers Back up only where a backup
 * is missing, and shows a failed read as its reviewed line.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { preferences } from "@bramble/testkit/sidepanel";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import {
  bindQsbAccounts,
  qsbAccountRows,
  qsbAccountsFlow,
} from "../../../../src/sidepanel/journeys/qsb/qsb-accounts";
import { walletViewLabel } from "../../../../src/sidepanel/shared/parts";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountApp,
  QSB_VIEWS,
  qsbStatus,
  type Scripted,
  scriptedQsbWallet,
} from "../../../support/qsb-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

const mount = (list: Scripted<readonly (typeof QSB_VIEWS)[keyof typeof QSB_VIEWS][]>) => {
  const app = mountApp(qsbAccountsFlow(qsbStatus));
  const { calls, wallet } = scriptedQsbWallet({ list });
  const opened: string[] = [];
  let created = 0;
  const listNode = app.querySelector<HTMLElement>("#qsb-accounts-list");
  if (!listNode) throw new Error("missing list");
  bindQsbAccounts({
    create: () => {
      created += 1;
    },
    list: listNode,
    openBackup: (id) => opened.push(id),
    root: app,
    wallet,
  });
  return { app, calls, created: () => created, list: listNode, opened };
};

const rowText = (app: HTMLElement, id: string): string =>
  app.querySelector(`[data-qsb-account="${id}"]`)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("Quantum-safe Bitcoin accounts", () => {
  test("the drawer links to the screen, which has its own title and route label", () => {
    const html = dashboard("home", qsbStatus, [], preferences, { balances: [] });
    const foot = html.slice(html.indexOf("drawer-foot"));
    expect(foot).toContain('data-view="qsb-accounts"');
    expect(foot).toContain("Quantum-safe Bitcoin");
    const screen = dashboard("qsb-accounts", qsbStatus, [], preferences, { balances: [] });
    expect(screen).toContain('id="wallet-screen-qsb-accounts"');
    expect(screen).toContain("<h1>Quantum-safe Bitcoin</h1>");
    expect(walletViewLabel("qsb-accounts")).toBe("Quantum-safe Bitcoin");
  });

  test("shows loading until the list answers, then one row per state", async () => {
    const { app, calls, list } = mount({
      resolve: [
        QSB_VIEWS.backupNeeded,
        QSB_VIEWS.ready,
        QSB_VIEWS.readOnly,
        QSB_VIEWS.historyUnavailable,
      ],
    });
    expect(list.textContent).toContain("Loading accounts…");
    await flush();
    expect(calls.list).toHaveLength(1);
    expect(rowText(app, "qsb-1")).toBe("Account 1 Backup needed Back up");
    expect(rowText(app, "qsb-2")).toBe("Account 2 Ready");
    expect(rowText(app, "qsb-3")).toBe("Account 3 Read-only");
    expect(rowText(app, "qsb-4")).toBe(
      "Account 4 History unavailable Bramble won't release any of its keys.",
    );
  });

  test("only an account without a backup offers Back up, which opens that account", async () => {
    const { app, opened } = mount({ resolve: [QSB_VIEWS.ready, QSB_VIEWS.backupNeeded] });
    await flush();
    const controls = app.querySelectorAll<HTMLButtonElement>("[data-qsb-back-up]");
    expect(controls).toHaveLength(1);
    expect(controls[0]?.getAttribute("aria-label")).toBe("Back up Account 1");
    controls[0]?.click();
    expect(opened).toEqual(["qsb-1"]);
  });

  test("Create account and Import phrase lead into the journey", () => {
    const { app, created } = mount({ resolve: [] });
    app.querySelector<HTMLButtonElement>("#qsb-create")?.click();
    expect(created()).toBe(1);
    // Import is a plain route the shell's navigation binds.
    expect(app.querySelector('[data-view="qsb-import"]')?.textContent).toContain("Import phrase");
  });

  test("an empty wallet says so", async () => {
    const { list } = mount({ resolve: [] });
    await flush();
    expect(list.textContent).toBe("No quantum-safe Bitcoin accounts yet.");
  });

  test("a failed read shows the refusal's reviewed sentence, not the raw diagnostic", async () => {
    const { list } = mount({ reject: new Error(QSB_ACCOUNT_REFUSALS.journalUnavailable) });
    await flush();
    expect(list.querySelector('[role="alert"]')?.textContent).toBe(
      "Bramble can't read this account's history, so it won't release any of its keys.",
    );
    const unrecognised = mount({ reject: new Error("wallet unavailable") });
    await flush();
    expect(unrecognised.list.textContent).toBe(
      "The wallet is locked or unavailable. Unlock it and try again.",
    );
  });

  test("the rows template escapes and states each account once", () => {
    const html = qsbAccountRows([QSB_VIEWS.backupNeeded, QSB_VIEWS.ready]);
    expect(html.match(/data-qsb-account=/g)).toHaveLength(2);
    expect(html).toContain('<span class="hint">Backup needed</span>');
    expect(html).toContain('<span class="hint">Ready</span>');
    expect(qsbAccountRows([])).toContain("No quantum-safe Bitcoin accounts yet.");
  });
});
