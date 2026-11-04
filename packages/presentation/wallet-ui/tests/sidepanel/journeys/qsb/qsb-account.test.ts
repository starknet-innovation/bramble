/**
 * One Quantum-safe Bitcoin account under happy-dom, through the journey: a
 * list row opens it; it shows the validated owner address behind a guarded
 * copy, the confirmed balance or a retry when the service is out of reach,
 * every vault state with its one action, New vault only for a writer (once,
 * however often it is asked), Resend once per waiting deposit, and a poll
 * that runs only while a deposit is on its way and the panel is visible.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { QSB_VAULT_POLL_MS } from "../../../../src/sidepanel/journeys/qsb/qsb-vault-poll";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  deferred,
  flush,
  QSB_VIEWS,
  type QsbScript,
  shownStep,
} from "../../../support/qsb-harness";
import { qsbPanel, setVisibility } from "../../../support/qsb-panel";
import {
  depositedVault,
  depositResult,
  EVERY_VAULT,
  QSB_ADDRESS,
  QSB_TXID,
  reading,
  unfundedVault,
} from "../../../support/qsb-vault-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
  setVisibility("visible");
});
afterEach(() => setVisibility("visible"));

const step = (app: HTMLElement): string | null => shownStep(app, "data-qsb-account-step");
// Each text node in order, joined by one space: the markup puts none between
// a label and its value.
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
const row = (app: HTMLElement, v: number) => app.querySelector(`[data-qsb-vault="${v}"]`);

// Opens `account` from the list, as a tap on its row does. The panel's
// `script` stays live: a test may change an answer between reads.
const opened = async (
  script: QsbScript,
  account: (typeof QSB_VIEWS)[keyof typeof QSB_VIEWS] = QSB_VIEWS.ready,
) => {
  const panel = qsbPanel({ list: { resolve: [account] }, ...script });
  panel.paint("qsb-accounts");
  await flush();
  panel.app().querySelector<HTMLButtonElement>(`[data-qsb-open="${account.id}"]`)?.click();
  await flush();
  return panel;
};

describe("a Quantum-safe Bitcoin account", () => {
  test("a list row opens it, with the address, the balance and every vault state", async () => {
    const panel = await opened({ vaults: { resolve: reading(EVERY_VAULT) } });
    const app = panel.app();
    expect(panel.visited).toEqual(["qsb-account"]);
    expect(step(app)).toBe("detail");
    expect(app.querySelector("#qsb-account-label")?.textContent).toBe("Account 2");
    expect(app.querySelector("#qsb-address")?.textContent).toBe(QSB_ADDRESS);
    expect(text(app.querySelector("#qsb-address-copy")?.closest(".section"))).toContain(
      "Send bitcoin here before you deposit.",
    );
    expect(text(app.querySelector("#qsb-balance"))).toBe("Confirmed balance 0.00250000 BTC");
    expect(text(row(app, 0))).toBe("Vault 1 Unfunded Deposit");
    expect(text(row(app, 1))).toBe("Vault 2 Deposit waiting 0.00100000 BTC Resend");
    expect(text(row(app, 2))).toBe("Vault 3 Deposit sent 0.00100000 BTC 4a5e1e…a33b");
    expect(text(row(app, 3))).toBe("Vault 4 Funded · 3 confirmations 0.00100000 BTC 4a5e1e…a33b");
    expect(text(row(app, 4))).toBe("Vault 5 Withdrawn 0.00100000 BTC 4a5e1e…a33b");
    expect(text(row(app, 5))).toBe("Vault 6 Unavailable");
    expect(app.querySelector("#qsb-vault-new")?.textContent).toBe("New vault");
    expect(panel.calls.vaults).toEqual(["qsb-2"]);
  });

  test("a txid links to mempool.space in an isolated tab, only once on the network", async () => {
    const panel = await opened({ vaults: { resolve: reading(EVERY_VAULT) } });
    const links = Array.from(panel.app().querySelectorAll<HTMLAnchorElement>("[data-qsb-tx]"));
    expect(
      links.map((link) => link.closest("[data-qsb-vault]")?.getAttribute("data-qsb-vault")),
    ).toEqual(["2", "3", "4"]);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(`https://mempool.space/tx/${QSB_TXID}`);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("aria-label")).toBe("View this transaction on mempool.space");
    }
  });

  test("the copy control copies only the validated address, and forgets it on leaving", async () => {
    const writes: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => void writes.push(value) },
    });
    const gate = deferred<ReturnType<typeof reading>>();
    const panel = await opened({ vaults: { wait: gate.promise } });
    const copy = panel.app().querySelector<HTMLButtonElement>("#qsb-address-copy");
    expect(copy?.disabled).toBe(true);
    expect(copy?.dataset["copy"]).toBe("");
    gate.resolve(reading());
    await flush();
    expect(copy?.disabled).toBe(false);
    copy?.click();
    await flush();
    expect(writes).toEqual([QSB_ADDRESS]);
    panel.journey.bind(null);
    expect(copy?.disabled).toBe(true);
    expect(copy?.dataset["copy"]).toBe("");
    expect(panel.app().querySelector("#qsb-address")?.textContent).toBe("");
  });

  test("an account that cannot make vaults gets a line instead, and no Deposit", async () => {
    for (const [account, line] of [
      [QSB_VIEWS.readOnly, "An imported phrase can't create new vaults here."],
      [QSB_VIEWS.backupNeeded, "Back up this account's phrase to make vaults."],
      [QSB_VIEWS.historyUnavailable, "Bramble won't release any of its keys."],
    ] as const) {
      const panel = await opened({ vaults: { resolve: reading(EVERY_VAULT) } }, account);
      const app = panel.app();
      expect(app.querySelector("#qsb-vault-new")).toBe(null);
      expect(text(app.querySelector("#qsb-vault-action"))).toBe(line);
      expect(app.querySelector("[data-qsb-deposit]")).toBe(null);
    }
  });

  test("an empty account says so", async () => {
    const panel = await opened({ vaults: { resolve: reading([]) } });
    expect(text(panel.app().querySelector("#qsb-vaults"))).toBe("No vaults yet.");
  });

  test("a service out of reach shows a line and a retry; the vaults still show", async () => {
    const panel = await opened({ vaults: { resolve: { ...reading(EVERY_VAULT), funds: null } } });
    const balance = panel.app().querySelector("#qsb-balance");
    expect(text(balance)).toBe("Can't reach the quantum-safe Bitcoin service. Try again");
    expect(row(panel.app(), 0)).not.toBe(null);
    balance?.querySelector<HTMLButtonElement>("[data-qsb-retry]")?.click();
    await flush();
    expect(panel.calls.vaults).toEqual(["qsb-2", "qsb-2"]);
  });

  test("a failed first read shows its reviewed line and Try again", async () => {
    const panel = await opened({
      vaults: { reject: new Error(QSB_VAULT_REFUSALS.runtimeUnavailable) },
    });
    const app = panel.app();
    expect(step(app)).toBe("unavailable");
    expect(app.querySelector("#qsb-account-error")?.textContent).toBe(
      "Couldn't build the vault. Try again.",
    );
    panel.script.vaults = { resolve: reading() };
    app.querySelector<HTMLButtonElement>("#qsb-account-retry")?.click();
    await flush();
    expect(step(app)).toBe("detail");
    expect(panel.calls.vaults).toEqual(["qsb-2", "qsb-2"]);
  });

  test("Refresh re-reads the account and its vaults; a failed one keeps the screen", async () => {
    const panel = await opened({ vaults: { resolve: reading() } });
    const app = panel.app();
    const listReads = panel.calls.list.length;
    panel.script.vaults = { reject: new Error(QSB_VAULT_REFUSALS.coordinatorUnavailable) };
    app.querySelector<HTMLButtonElement>("#qsb-account-refresh")?.click();
    expect(app.querySelector<HTMLButtonElement>("#qsb-account-refresh")?.disabled).toBe(true);
    await flush();
    expect(panel.calls.list).toHaveLength(listReads + 1);
    expect(panel.calls.vaults).toEqual(["qsb-2", "qsb-2"]);
    expect(step(app)).toBe("detail");
    expect(app.querySelector("#qsb-address")?.textContent).toBe(QSB_ADDRESS);
    expect(app.querySelector("#qsb-vault-result")?.textContent).toBe(
      "Couldn't reach the quantum-safe Bitcoin service. Try again.",
    );
    expect(app.querySelector<HTMLButtonElement>("#qsb-account-refresh")?.disabled).toBe(false);
  });

  test("an account that is not in the wallet is said so, without a retry", async () => {
    const panel = qsbPanel({
      list: { resolve: [QSB_VIEWS.ready] },
      vaults: { resolve: reading() },
    });
    panel.journey.openAccount("qsb-9");
    await flush();
    expect(step(panel.app())).toBe("unavailable");
    expect(panel.app().querySelector("#qsb-account-error")?.textContent).toBe(
      "That account isn't in this wallet.",
    );
    expect(panel.app().querySelector<HTMLButtonElement>("#qsb-account-retry")?.hidden).toBe(true);
  });
});

describe("New vault", () => {
  test("confirms, creates once, and lands back on the account with the new vault", async () => {
    const created = deferred<ReturnType<typeof unfundedVault>>();
    const panel = await opened({
      createVault: { wait: created.promise },
      vaults: { resolve: reading([depositedVault(0, "confirmed")]) },
    });
    const app = panel.app();
    app.querySelector<HTMLButtonElement>("#qsb-vault-new")?.click();
    expect(step(app)).toBe("confirm");
    expect(text(app.querySelector('[data-qsb-account-step="confirm"]'))).toBe(
      "New vault Bramble registers a new vault with the quantum-safe Bitcoin service. It takes one deposit. Create vault Cancel",
    );
    app.querySelector<HTMLButtonElement>("#qsb-vault-create")?.click();
    app.querySelector<HTMLButtonElement>("#qsb-vault-create")?.click();
    expect(step(app)).toBe("creating");
    expect(text(app.querySelector('[data-qsb-account-step="creating"]'))).toBe("Creating vault…");
    // Leaving and coming back reattaches to the same creation.
    panel.paint("qsb-accounts");
    await flush();
    panel.journey.openAccount("qsb-2");
    await flush();
    expect(step(panel.app())).toBe("creating");
    expect(panel.calls.createVault).toEqual(["qsb-2"]);
    created.resolve(unfundedVault(1));
    await flush();
    expect(step(panel.app())).toBe("detail");
    expect(text(row(panel.app(), 1))).toBe("Vault 2 Unfunded Deposit");
  });

  test("Cancel creates nothing", async () => {
    const panel = await opened({ vaults: { resolve: reading([]) } });
    const app = panel.app();
    app.querySelector<HTMLButtonElement>("#qsb-vault-new")?.click();
    app.querySelector<HTMLButtonElement>("#qsb-vault-cancel")?.click();
    expect(step(app)).toBe("detail");
    expect(panel.calls.createVault).toEqual([]);
  });

  test("a refusal shows its reviewed line; a lost reply never reads as failed", async () => {
    const refused = await opened({
      createVault: { reject: new Error(QSB_VAULT_REFUSALS.vaultLimit) },
      vaults: { resolve: reading([]) },
    });
    refused.app().querySelector<HTMLButtonElement>("#qsb-vault-new")?.click();
    refused.app().querySelector<HTMLButtonElement>("#qsb-vault-create")?.click();
    await flush();
    expect(step(refused.app())).toBe("detail");
    expect(refused.app().querySelector("#qsb-vault-result")?.textContent).toBe(
      "This account already holds as many vaults as it can.",
    );
    const lost = await opened({
      createVault: { reject: new SubmissionUnknownError("lost", null) },
      vaults: { resolve: reading([]) },
    });
    lost.app().querySelector<HTMLButtonElement>("#qsb-vault-new")?.click();
    lost.app().querySelector<HTMLButtonElement>("#qsb-vault-create")?.click();
    await flush();
    expect(lost.app().querySelector("#qsb-vault-result")?.textContent).toBe(
      "Bramble couldn't confirm this finished. Refresh the account before trying again.",
    );
  });
});

describe("Resend", () => {
  test("resends a waiting deposit once and says how it went", async () => {
    const resent = deferred<ReturnType<typeof depositResult>>();
    const panel = await opened({
      resend: { wait: resent.promise },
      vaults: { resolve: reading([depositedVault(0, "pending")]) },
    });
    const control = panel.app().querySelector<HTMLButtonElement>('[data-qsb-resend="0"]');
    control?.click();
    const busy = panel.app().querySelector<HTMLButtonElement>('[data-qsb-resend="0"]');
    expect(busy?.disabled).toBe(true);
    busy?.click();
    control?.click();
    expect(panel.calls.resend).toEqual([["qsb-2", 0]]);
    resent.resolve(depositResult(0, "submitted"));
    await flush();
    expect(panel.app().querySelector("#qsb-vault-result")?.textContent).toBe(
      "Deposit sent. The vault shows as funded once it's mined.",
    );
    expect(text(row(panel.app(), 0))).toBe("Vault 1 Deposit sent 0.00100000 BTC 4a5e1e…a33b");
  });
});

describe("the deposit poll", () => {
  test("re-reads about once a minute while a deposit is on its way", async () => {
    const panel = await opened({ vaults: { resolve: reading([depositedVault(0, "submitted")]) } });
    const listReads = panel.calls.list.length;
    expect(panel.timers.pending()).toBe(1);
    panel.timers.advance(QSB_VAULT_POLL_MS - 1);
    expect(panel.calls.vaults).toHaveLength(1);
    panel.timers.advance(1);
    await flush();
    expect(panel.calls.vaults).toHaveLength(2);
    // Only the vaults are re-read, never the account list.
    expect(panel.calls.list).toHaveLength(listReads);
    expect(panel.timers.pending()).toBe(1);
    panel.journey.bind(null);
    expect(panel.timers.pending()).toBe(0);
  });

  test("stops once nothing is in flight", async () => {
    const panel = await opened({ vaults: { resolve: reading([depositedVault(0, "pending")]) } });
    expect(panel.timers.pending()).toBe(1);
    panel.script.vaults = { resolve: reading([depositedVault(0, "confirmed")]) };
    panel.timers.advance(QSB_VAULT_POLL_MS);
    await flush();
    expect(text(row(panel.app(), 0))).toContain("Funded");
    expect(panel.timers.pending()).toBe(0);
    panel.timers.flush();
    expect(panel.calls.vaults).toHaveLength(2);
  });

  test("does nothing while the panel is hidden and re-reads as it comes back", async () => {
    const panel = await opened({ vaults: { resolve: reading([depositedVault(0, "pending")]) } });
    setVisibility("hidden");
    expect(panel.timers.pending()).toBe(0);
    panel.timers.flush();
    expect(panel.calls.vaults).toHaveLength(1);
    setVisibility("visible");
    await flush();
    expect(panel.calls.vaults).toHaveLength(2);
    expect(panel.timers.pending()).toBe(1);
  });

  test("never runs for an account with nothing in flight, and ends when the screen is left", async () => {
    const idle = await opened({ vaults: { resolve: reading([unfundedVault(0)]) } });
    expect(idle.timers.pending()).toBe(0);
    const busy = await opened({ vaults: { resolve: reading([depositedVault(0, "pending")]) } });
    busy.paint("qsb-accounts");
    expect(busy.timers.pending()).toBe(0);
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(busy.calls.vaults).toHaveLength(1);
  });
});
