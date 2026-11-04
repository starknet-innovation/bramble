/**
 * The QSB journey: creation runs once however often it is
 * asked and lands in the new account's backup, a refused creation shows why,
 * the list's Back up opens that account, a row opens the account and its
 * Deposit the deposit screen, and binding the next screen wipes the one
 * before it, which is how leaving a screen clears its fields.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import type { WalletView } from "../../../../src/sidepanel/app/screens/views";
import { createQsbJourney } from "../../../../src/sidepanel/journeys/qsb/qsb-journey";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountApp,
  QSB_VIEWS,
  type QsbScript,
  scriptedQsbWallet,
  shownStep,
  submitForm,
  TEST_PHRASE,
  typeInto,
} from "../../../support/qsb-harness";
import { qsbScreen, scriptedPermissions } from "../../../support/qsb-panel";
import { reading, unfundedVault } from "../../../support/qsb-vault-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

// A panel stand-in: navigation paints the view's real markup and binds it,
// as the side panel's paint loop does.
const panel = (script: QsbScript) => {
  const { calls, wallet } = scriptedQsbWallet(script);
  const visited: WalletView[] = [];
  let backs = 0;
  let app: HTMLElement | null = null;
  const journey = createQsbJourney({
    back: () => {
      backs += 1;
    },
    navigate: (view) => {
      visited.push(view);
      app = mountApp(qsbScreen(view));
      journey.bind(app);
    },
    now: () => 0,
    permissions: scriptedPermissions().api,
    wallet,
  });
  return {
    app: () => app,
    backs: () => backs,
    calls,
    journey,
    paint: (view: WalletView) => {
      app = mountApp(qsbScreen(view));
      journey.bind(app);
      return app;
    },
    visited,
  };
};

const backupStep = (app: HTMLElement | null): string | null =>
  app ? shownStep(app, "data-qsb-step") : null;

describe("the QSB journey", () => {
  test("create goes straight into the new account's backup", async () => {
    const p = panel({ create: { resolve: { ...QSB_VIEWS.backupNeeded, id: "qsb-6" } } });
    p.journey.open("create");
    expect(p.visited).toEqual(["qsb-backup"]);
    expect(backupStep(p.app())).toBe("creating");
    await flush();
    expect(backupStep(p.app())).toBe("passphrase");
    expect(p.app()?.querySelector("#qsb-backup-account")?.textContent).toBe("QSB vault 6");
  });

  test("a second create while one is in flight never makes a second account", () => {
    const p = panel({});
    p.journey.open("create");
    p.journey.open("create");
    p.app()?.querySelector<HTMLButtonElement>("#qsb-create")?.click();
    expect(p.calls.create).toHaveLength(1);
    expect(backupStep(p.app())).toBe("creating");
  });

  test("a refused creation shows its reviewed sentence and a way to the list", async () => {
    const p = panel({ create: { reject: new Error(QSB_ACCOUNT_REFUSALS.accountLimit) } });
    p.journey.open("create");
    await flush();
    expect(backupStep(p.app())).toBe("unavailable");
    expect(p.app()?.querySelector("#qsb-backup-error")?.textContent).toBe(
      "This wallet already holds as many QSB vaults as it can.",
    );
  });

  test("the list's Back up and Create lead into the backup screen", async () => {
    const p = panel({ list: { resolve: [QSB_VIEWS.backupNeeded] } });
    const app = p.paint("qsb-accounts");
    await flush();
    app.querySelector<HTMLButtonElement>('[data-qsb-back-up="qsb-1"]')?.click();
    expect(p.visited).toEqual(["qsb-backup"]);
    expect(p.app()?.querySelector("#qsb-backup-account")?.textContent).toBe("QSB vault 1");
    p.paint("qsb-accounts").querySelector<HTMLButtonElement>("#qsb-create")?.click();
    expect(p.calls.create).toHaveLength(1);
  });

  test("a row opens the account, and its Deposit the deposit screen", async () => {
    const p = panel({
      list: { resolve: [QSB_VIEWS.ready] },
      vaults: { resolve: reading([unfundedVault(0)]) },
    });
    p.paint("qsb-accounts").querySelector<HTMLButtonElement>('[data-qsb-open="qsb-2"]');
    await flush();
    p.app()?.querySelector<HTMLButtonElement>('[data-qsb-open="qsb-2"]')?.click();
    await flush();
    expect(p.visited).toEqual(["qsb-account"]);
    expect(p.calls.vaults).toEqual(["qsb-2"]);
    p.app()?.querySelector<HTMLButtonElement>('[data-qsb-deposit="0"]')?.click();
    await flush();
    expect(p.visited).toEqual(["qsb-account", "qsb-deposit"]);
    expect(p.app()?.querySelector("#qsb-deposit-vault")?.textContent).toBe(
      "QSB vault 2 · Deposit 1",
    );
  });

  test("open('import') opens the import screen; Done goes back", async () => {
    const p = panel({ import: { resolve: QSB_VIEWS.readOnly } });
    p.journey.open("import");
    expect(p.visited).toEqual(["qsb-import"]);
    const form = p.app()?.querySelector<HTMLFormElement>("#qsb-import-form");
    typeInto(
      form?.querySelector<HTMLInputElement>('input[data-recovery-kind="import"]'),
      TEST_PHRASE,
    );
    submitForm(form);
    await flush();
    form?.querySelector<HTMLButtonElement>("#qsb-import-finish")?.click();
    expect(p.backs()).toBe(1);
  });

  test("binding the next screen wipes the phrase and passphrase from the one left", async () => {
    const p = panel({ reveal: { resolve: TEST_PHRASE } });
    p.journey.openBackup("qsb-1");
    const left = p.app();
    if (!left) throw new Error("no backup screen");
    const passphrase = left.querySelector<HTMLInputElement>('input[name="vaultPassphrase"]');
    if (passphrase) passphrase.value = "correct horse battery";
    submitForm(left.querySelector<HTMLFormElement>("#qsb-reveal-form"));
    await flush();
    const cells = Array.from(
      left.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="generated"]'),
    );
    expect(cells[23]?.value).toBe("art");
    // A repaint (leaving, a request takeover, a lock) binds whatever replaced it.
    p.journey.bind(null);
    expect(cells.every((cell) => cell.value === "")).toBe(true);
    // The import screen is wiped the same way.
    p.journey.open("import");
    const importCells = Array.from(
      p.app()?.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="import"]') ?? [],
    );
    typeInto(importCells[0], TEST_PHRASE);
    p.paint("qsb-accounts");
    expect(importCells.every((cell) => cell.value === "")).toBe(true);
  });
});
