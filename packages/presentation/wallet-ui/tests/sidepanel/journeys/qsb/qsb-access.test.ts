/**
 * The QSB coordinator grant under happy-dom. Granted, the
 * screens read as before; missing, the account's balance gives way to Allow
 * access, and New vault, Deposit, Resend, Review and the deposit itself ask
 * for the grant in their own click (synchronously, so the browser sees the
 * gesture) before sending anything. A denial, or no permission API at all,
 * sends nothing and says why; only the coordinator's own pattern is ever
 * checked or asked for.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { QSB_COORDINATOR_PERMISSION, QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { createQsbAccess } from "../../../../src/sidepanel/journeys/qsb/qsb-access";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { flush, QSB_VIEWS, type QsbScript, shownStep } from "../../../support/qsb-harness";
import { qsbPanel, scriptedPermissions } from "../../../support/qsb-panel";
import {
  depositedVault,
  depositResult,
  QUOTE,
  reading,
  unfundedVault,
} from "../../../support/qsb-vault-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

const ACCESS_LINE = "Bramble needs access to the QSB service.";
const ACCESS_NEEDED = "Allow Bramble to reach the QSB service to continue.";

type Panel = ReturnType<typeof qsbPanel>;

const text = (node: Element | null | undefined): string => {
  if (!node) return "";
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const value = next.textContent?.replace(/\s+/g, " ").trim();
    if (value) parts.push(value);
  }
  return parts.join(" ");
};
const click = (panel: Panel, selector: string): void => {
  const control = panel.app().querySelector<HTMLButtonElement>(selector);
  if (!control) throw new Error(`missing ${selector}`);
  control.click();
};

// What the background answers without the grant: no funds, registration unknown.
const ungranted = (vaults = [unfundedVault(0), depositedVault(1, "pending")]) => ({
  ...reading(vaults.map((vault) => ({ ...vault, registered: null }))),
  funds: null,
});

// Opens the ready account with the grant in `granted`, the prompt answering `answer`.
const account = async (script: QsbScript, granted: boolean, answer = true): Promise<Panel> => {
  const panel = qsbPanel(
    { list: { resolve: [QSB_VIEWS.ready] }, ...script },
    scriptedPermissions({ answer, granted }),
  );
  panel.journey.openAccount("qsb-2");
  await flush();
  return panel;
};

describe("the coordinator grant", () => {
  test("only its own pattern is checked or asked for; no API or a throw reads as no", async () => {
    const permissions = scriptedPermissions({ granted: false });
    const access = createQsbAccess(permissions.api);
    expect(await access.check()).toBe(false);
    expect(await access.request()).toBe(true);
    expect(permissions.checked).toEqual([[QSB_COORDINATOR_PERMISSION]]);
    expect(permissions.asked).toEqual([[QSB_COORDINATOR_PERMISSION]]);
    const none = createQsbAccess(null);
    expect(await none.check()).toBe(false);
    expect(await none.request()).toBe(false);
    const broken = createQsbAccess({
      contains: () => Promise.reject(new Error("no")),
      request: () => {
        throw new Error("not in a gesture");
      },
    });
    expect(await broken.check()).toBe(false);
    expect(await broken.request()).toBe(false);
    const odd = createQsbAccess({
      contains: async () => "yes" as unknown as boolean,
      request: async () => 1 as unknown as boolean,
    });
    expect(await odd.check()).toBe(false);
    expect(await odd.request()).toBe(false);
  });
});

describe("the account screen", () => {
  test("granted: the balance shows and nothing is asked", async () => {
    const panel = await account({ vaults: { resolve: reading() } }, true);
    expect(text(panel.app().querySelector("#qsb-balance"))).toBe(
      "Confirmed balance 0.00250000 BTC",
    );
    expect(panel.app().querySelector("[data-qsb-allow]")).toBe(null);
    expect(panel.permissions.checked).toEqual([[QSB_COORDINATOR_PERMISSION]]);
    expect(panel.permissions.asked).toEqual([]);
  });

  test("missing: one line and Allow access replace the balance; the vaults still show", async () => {
    const panel = await account({ vaults: { resolve: ungranted() } }, false);
    const app = panel.app();
    expect(text(app.querySelector("#qsb-balance"))).toBe(`${ACCESS_LINE} Allow access`);
    expect(text(app.querySelector("#qsb-balance"))).not.toContain("Can't reach");
    expect(app.querySelector('[data-qsb-vault="0"]')).not.toBe(null);
    expect(app.querySelector("#qsb-vault-new")).not.toBe(null);
    expect(panel.permissions.asked).toEqual([]);
  });

  test("Allow access asks in the click itself, then refreshes", async () => {
    const panel = await account({ vaults: { resolve: ungranted() } }, false);
    const reads = panel.calls.vaults.length;
    panel.script.vaults = { resolve: reading() };
    click(panel, "[data-qsb-allow]");
    // Asked before any await: the browser still sees the gesture.
    expect(panel.permissions.asked).toEqual([[QSB_COORDINATOR_PERMISSION]]);
    await flush();
    expect(panel.calls.vaults).toHaveLength(reads + 1);
    expect(text(panel.app().querySelector("#qsb-balance"))).toBe(
      "Confirmed balance 0.00250000 BTC",
    );
  });

  test("Allow access denied: the line stays, and it re-read to be sure", async () => {
    const panel = await account({ vaults: { resolve: ungranted() } }, false, false);
    const reads = panel.calls.vaults.length;
    click(panel, "[data-qsb-allow]");
    await flush();
    expect(panel.calls.vaults).toHaveLength(reads + 1);
    expect(text(panel.app().querySelector("#qsb-balance"))).toBe(`${ACCESS_LINE} Allow access`);
  });

  test("New vault asks in its click; once granted it creates and re-reads", async () => {
    const panel = await account(
      { createVault: { resolve: unfundedVault(2) }, vaults: { resolve: ungranted() } },
      false,
    );
    panel.script.vaults = { resolve: reading([unfundedVault(0), unfundedVault(2)]) };
    click(panel, "#qsb-vault-new");
    click(panel, "#qsb-vault-create");
    expect(panel.permissions.asked).toHaveLength(1);
    expect(panel.calls.createVault).toEqual([]);
    await flush();
    await flush();
    expect(panel.calls.createVault).toEqual(["qsb-2"]);
    expect(shownStep(panel.app(), "data-qsb-account-step")).toBe("detail");
    expect(panel.app().querySelector('[data-qsb-vault="2"]')).not.toBe(null);
    expect(text(panel.app().querySelector("#qsb-balance"))).toBe(
      "Confirmed balance 0.00250000 BTC",
    );
  });

  test("New vault denied: nothing is sent and the screen says why", async () => {
    const panel = await account(
      { createVault: { resolve: unfundedVault(2) }, vaults: { resolve: ungranted() } },
      false,
      false,
    );
    click(panel, "#qsb-vault-new");
    click(panel, "#qsb-vault-create");
    await flush();
    expect(panel.calls.createVault).toEqual([]);
    expect(shownStep(panel.app(), "data-qsb-account-step")).toBe("detail");
    expect(panel.app().querySelector("#qsb-vault-result")?.textContent).toBe(ACCESS_NEEDED);
  });

  test("Deposit asks in its click and opens the deposit only once granted", async () => {
    const denied = await account({ vaults: { resolve: ungranted() } }, false, false);
    click(denied, '[data-qsb-deposit="0"]');
    expect(denied.permissions.asked).toHaveLength(1);
    await flush();
    expect(denied.visited).toEqual(["qsb-account"]);
    expect(denied.app().querySelector("#qsb-vault-result")?.textContent).toBe(ACCESS_NEEDED);

    const granted = await account({ vaults: { resolve: ungranted() } }, false, true);
    granted.script.vaults = { resolve: reading() };
    click(granted, '[data-qsb-deposit="0"]');
    await flush();
    expect(granted.visited).toEqual(["qsb-account", "qsb-deposit"]);
    expect(shownStep(granted.app(), "data-qsb-deposit-step")).toBe("amount");
  });

  test("Resend denied sends nothing", async () => {
    const panel = await account(
      { resend: { resolve: depositResult(1, "submitted") }, vaults: { resolve: ungranted() } },
      false,
      false,
    );
    click(panel, '[data-qsb-resend="1"]');
    await flush();
    expect(panel.calls.resend).toEqual([]);
    expect(panel.app().querySelector("#qsb-vault-result")?.textContent).toBe(ACCESS_NEEDED);
  });

  test("a grant withdrawn since the check: the refusal says why and Allow access returns", async () => {
    const panel = await account(
      {
        createVault: { reject: new Error(QSB_VAULT_REFUSALS.accessNeeded) },
        vaults: { resolve: reading() },
      },
      true,
    );
    click(panel, "#qsb-vault-new");
    click(panel, "#qsb-vault-create");
    await flush();
    expect(panel.calls.createVault).toEqual(["qsb-2"]);
    expect(panel.app().querySelector("#qsb-vault-result")?.textContent).toBe(ACCESS_NEEDED);
    expect(panel.app().querySelector("[data-qsb-allow]")).not.toBe(null);
  });

  test("without a permission API nothing that needs the coordinator is sent", async () => {
    const panel = qsbPanel(
      {
        createVault: { resolve: unfundedVault(2) },
        list: { resolve: [QSB_VIEWS.ready] },
        vaults: { resolve: ungranted() },
      },
      {
        ...scriptedPermissions(),
        api: null as unknown as ReturnType<typeof scriptedPermissions>["api"],
      },
    );
    panel.journey.openAccount("qsb-2");
    await flush();
    expect(panel.app().querySelector("[data-qsb-allow]")).not.toBe(null);
    click(panel, "#qsb-vault-new");
    click(panel, "#qsb-vault-create");
    await flush();
    expect(panel.calls.createVault).toEqual([]);
  });
});

describe("the deposit screen", () => {
  // Opens the deposit into vault 0 directly, as after a grant was withdrawn.
  const deposit = async (script: QsbScript, granted: boolean, answer = true): Promise<Panel> => {
    const panel = qsbPanel(
      { list: { resolve: [QSB_VIEWS.ready] }, quote: { resolve: QUOTE }, ...script },
      scriptedPermissions({ answer, granted }),
    );
    panel.journey.openDeposit("qsb-2", 0);
    await flush();
    return panel;
  };
  const step = (panel: Panel): string | null => shownStep(panel.app(), "data-qsb-deposit-step");

  test("missing: Allow access in place of the amount, asked in its click, then re-read", async () => {
    const panel = await deposit({ vaults: { resolve: ungranted([unfundedVault(0)]) } }, false);
    expect(step(panel)).toBe("unavailable");
    const line = panel.app().querySelector("#qsb-deposit-error");
    expect(line?.textContent).toBe(ACCESS_LINE);
    // A step to take, not a failure: never in the danger style.
    expect(line?.classList.contains("review-flag")).toBe(false);
    expect(panel.app().querySelector<HTMLButtonElement>("#qsb-deposit-retry")?.hidden).toBe(true);
    const allow = panel.app().querySelector<HTMLButtonElement>("#qsb-deposit-allow");
    expect(allow?.hidden).toBe(false);
    expect(document.activeElement).toBe(allow);
    panel.script.vaults = { resolve: reading([unfundedVault(0)]) };
    allow?.click();
    expect(panel.permissions.asked).toEqual([[QSB_COORDINATOR_PERMISSION]]);
    await flush();
    expect(step(panel)).toBe("amount");
  });

  test("denied: the screen stays where it was", async () => {
    const panel = await deposit(
      { vaults: { resolve: ungranted([unfundedVault(0)]) } },
      false,
      false,
    );
    panel.app().querySelector<HTMLButtonElement>("#qsb-deposit-allow")?.click();
    await flush();
    expect(step(panel)).toBe("unavailable");
    expect(panel.calls.quote).toEqual([]);
  });

  test("a grant withdrawn mid-flow: Review and Deposit ask again in their own click", async () => {
    const panel = await deposit(
      {
        deposit: { resolve: depositResult(0, "submitted") },
        quote: { reject: new Error(QSB_VAULT_REFUSALS.accessNeeded) },
        vaults: { resolve: reading([unfundedVault(0)]) },
      },
      true,
      false,
    );
    const input = panel.app().querySelector<HTMLInputElement>('input[name="qsbAmount"]');
    if (input) input.value = "0.001";
    const review = panel.app().querySelector<HTMLFormElement>("#qsb-amount-form");
    review?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(panel.app().querySelector("#qsb-amount-result")?.textContent).toBe(ACCESS_NEEDED);
    // The next Review asks first; denied, no quote is sent.
    review?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(panel.permissions.asked).toHaveLength(1);
    await flush();
    expect(panel.calls.quote).toHaveLength(1);
    expect(panel.app().querySelector("#qsb-amount-result")?.textContent).toBe(ACCESS_NEEDED);
    // Granted, the quote goes out and the deposit after it.
    panel.permissions.state.answer = true;
    panel.script.quote = { resolve: QUOTE };
    review?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    expect(step(panel)).toBe("review");
    const box = panel.app().querySelector<HTMLInputElement>('input[name="qsbAccept"]');
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    panel
      .app()
      .querySelector<HTMLFormElement>("#qsb-review-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(panel.calls.deposit).toEqual([["qsb-2", 0, 100_000, 564]]);
  });

  test("a deposit refused for want of the grant keeps the review and sends nothing more", async () => {
    const panel = await deposit(
      {
        deposit: { reject: new Error(QSB_VAULT_REFUSALS.accessNeeded) },
        vaults: { resolve: reading([unfundedVault(0)]) },
      },
      true,
      false,
    );
    const input = panel.app().querySelector<HTMLInputElement>('input[name="qsbAmount"]');
    if (input) input.value = "0.001";
    panel
      .app()
      .querySelector<HTMLFormElement>("#qsb-amount-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    const box = panel.app().querySelector<HTMLInputElement>('input[name="qsbAccept"]');
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const form = panel.app().querySelector<HTMLFormElement>("#qsb-review-form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(step(panel)).toBe("review");
    expect(panel.app().querySelector("#qsb-review-result")?.textContent).toBe(ACCESS_NEEDED);
    // Asked again in the next click; denied, nothing more is sent.
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(panel.permissions.asked).toHaveLength(1);
    await flush();
    expect(panel.calls.deposit).toHaveLength(1);
  });
});
