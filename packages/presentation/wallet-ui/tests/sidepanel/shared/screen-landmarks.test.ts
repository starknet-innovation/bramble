/**
 * Screen landmarks (issue 526). Every page that hosts the wallet provides the
 * one `<main id="app">`, so a screen must never be a `main` of its own: a
 * nested or second `main` fails axe's landmark rules, and `tabpanel` is not a
 * role a `main` element may take.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { dashboard } from "../../../src/sidepanel/app/screens/views";
import { locked } from "../../../src/sidepanel/journeys/onboarding/gate-views";
import { dockScreen, flowScreen } from "../../../src/sidepanel/shared/parts";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

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

const hosted = (markup: string): Document => {
  document.body.innerHTML = `<main id="app">${markup}</main>`;
  return document;
};

const SOURCE_ROOT = join(import.meta.dir, "../../../src");

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });

describe("screen landmarks", () => {
  test("a docked screen is a tab panel section, not a main", () => {
    const doc = hosted(dockScreen("home", "<h1>Home</h1>"));
    const screen = doc.querySelector("#wallet-screen-home");

    expect(screen?.tagName).toBe("SECTION");
    expect(screen?.getAttribute("role")).toBe("tabpanel");
    expect(doc.querySelectorAll("main")).toHaveLength(1);
  });

  test("a flow screen is a section, not a main", () => {
    const doc = hosted(flowScreen("send", "<h1>Send</h1>"));

    expect(doc.querySelector("#wallet-screen-send")?.tagName).toBe("SECTION");
    expect(doc.querySelectorAll("main")).toHaveLength(1);
  });

  for (const view of ["home", "activity", "settings"] as const) {
    test(`the ${view} dashboard leaves the host main as the only main`, () => {
      const doc = hosted(dashboard(view, status, [], preferences, { balances: [] }));

      expect(doc.querySelectorAll("main")).toHaveLength(1);
      expect(doc.querySelector("main main")).toBeNull();
      expect(doc.querySelector('main[role="tabpanel"]')).toBeNull();
    });
  }

  test("the locked gate leaves the host main as the only main", () => {
    const doc = hosted(locked({ ...status, locked: true }));

    expect(doc.querySelectorAll("main")).toHaveLength(1);
  });

  test("no side-panel renderer emits a main element", () => {
    const offenders = sourceFiles(SOURCE_ROOT).filter((path) =>
      /<main[\s>]/.test(
        readFileSync(path, "utf8")
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
          .join("\n"),
      ),
    );

    expect(offenders).toEqual([]);
  });
});
