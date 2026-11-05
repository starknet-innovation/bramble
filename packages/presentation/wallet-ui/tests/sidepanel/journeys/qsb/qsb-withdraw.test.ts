/**
 * Withdrawing a QSB deposit under happy-dom, through the journey: each row
 * shows its withdrawal state with its one action (Withdraw for a funded
 * deposit, writers only; Review once a solution is ready; Resend when not
 * confirmed yet), the poll keeps running while a withdrawal moves on its own,
 * and the Withdraw flow checks the address, quotes it, sums what the
 * destination receives, waits for the costs to be accepted, starts once with
 * the quote's own fee and goes back to the QSB vault screen.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  QSB_WITHDRAWAL_REFUSALS,
  type QsbWithdrawalStatus,
} from "@bramble/wallet-model/qsb-withdrawals";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { QSB_VAULT_POLL_MS } from "../../../../src/sidepanel/journeys/qsb/qsb-vault-poll";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  deferred,
  flush,
  QSB_VIEWS,
  type QsbScript,
  shownStep,
  submitForm,
  typeInto,
} from "../../../support/qsb-harness";
import { qsbPanel, scriptedPermissions, setVisibility } from "../../../support/qsb-panel";
import {
  DESTINATION,
  depositedVault,
  reading,
  WITHDRAWAL_QUOTE,
  WITHDRAWAL_TXID,
  withdrawalResult,
  withdrawingVault,
} from "../../../support/qsb-vault-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
  setVisibility("visible");
});
afterEach(() => setVisibility("visible"));

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
const find = <T extends Element>(panel: Panel, selector: string): T | null =>
  panel.app().querySelector<T>(selector);
const row = (panel: Panel, v: number) => find(panel, `[data-qsb-vault="${v}"]`);

const STATES: readonly QsbWithdrawalStatus[] = [
  "searching",
  "paused",
  "failed",
  "ready",
  "pending",
  "submitted",
  "uncertain",
  "confirmed",
  "conflict",
];

// Opens QSB vault 2 (a writer) over `script`, its grant held or not.
const account = async (script: QsbScript, granted = true, answer = true): Promise<Panel> => {
  const panel = qsbPanel(
    { list: { resolve: [QSB_VIEWS.ready] }, ...script },
    scriptedPermissions({ answer, granted }),
  );
  panel.journey.openAccount("qsb-2");
  await flush();
  return panel;
};

// Opens the Withdraw flow for deposit 1 (v 0) from its row.
const withdraw = async (script: QsbScript): Promise<Panel> => {
  const panel = await account({
    vaults: { resolve: reading([depositedVault(0, "confirmed")]) },
    withdrawalQuote: { resolve: WITHDRAWAL_QUOTE },
    ...script,
  });
  find<HTMLButtonElement>(panel, '[data-qsb-withdraw="0"]')?.click();
  await flush();
  return panel;
};
const step = (panel: Panel): string | null => shownStep(panel.app(), "data-qsb-withdraw-step");
const toSummary = async (panel: Panel, typed = DESTINATION): Promise<void> => {
  typeInto(find<HTMLInputElement>(panel, 'input[name="qsbDestination"]'), typed);
  submitForm(find<HTMLFormElement>(panel, "#qsb-destination-form"));
  await flush();
};
const accept = (panel: Panel): void => {
  const box = find<HTMLInputElement>(panel, 'input[name="qsbWithdrawAccept"]');
  if (!box) throw new Error("missing checkbox");
  box.checked = true;
  box.dispatchEvent(new Event("change", { bubbles: true }));
};
const startButton = (panel: Panel) =>
  find<HTMLButtonElement>(panel, '#qsb-withdraw-form button[type="submit"]');

describe("deposit rows", () => {
  test("show each withdrawal state with its one action", async () => {
    const panel = await account({
      vaults: { resolve: reading(STATES.map((status, v) => withdrawingVault(v, status))) },
    });
    expect(STATES.map((_, v) => text(row(panel, v)))).toEqual([
      "Deposit 1 Withdrawing This can take hours. 0.00100000 BTC 4a5e1e…a33b",
      "Deposit 2 Withdrawal paused 0.00100000 BTC 4a5e1e…a33b",
      "Deposit 3 Withdrawal failed Its bitcoin stays locked in this deposit. 0.00100000 BTC 4a5e1e…a33b",
      "Deposit 4 Ready to release 0.00100000 BTC 4a5e1e…a33b Review",
      "Deposit 5 Sending 0.00100000 BTC 4a5e1e…a33b",
      "Deposit 6 Withdrawal sent 0.00100000 BTC f4184f…9e16",
      "Deposit 7 Not confirmed yet 0.00100000 BTC 4a5e1e…a33b Resend",
      "Deposit 8 Withdrawn · 2 confirmations 0.00100000 BTC f4184f…9e16",
      "Deposit 9 Spent elsewhere 0.00100000 BTC 4a5e1e…a33b",
    ]);
    // A sent or mined withdrawal links its own transaction.
    expect(row(panel, 5)?.querySelector("a")?.getAttribute("href")).toBe(
      `https://mempool.space/tx/${WITHDRAWAL_TXID}`,
    );
    expect(find(panel, '[data-qsb-review="3"]')?.getAttribute("aria-label")).toBe(
      "Review the withdrawal of deposit 4",
    );
    expect(find(panel, '[data-qsb-resend-withdrawal="6"]')?.getAttribute("aria-label")).toBe(
      "Resend the withdrawal of deposit 7",
    );
  });

  test("a funded deposit offers Withdraw to a writer only", async () => {
    const writer = await account({
      vaults: { resolve: reading([depositedVault(0, "confirmed")]) },
    });
    expect(find(writer, '[data-qsb-withdraw="0"]')?.getAttribute("aria-label")).toBe(
      "Withdraw deposit 1",
    );
    const panel = qsbPanel({
      list: { resolve: [QSB_VIEWS.readOnly] },
      vaults: { resolve: reading([depositedVault(0, "confirmed"), withdrawingVault(1, "ready")]) },
    });
    panel.journey.openAccount("qsb-3");
    await flush();
    expect(find(panel, "[data-qsb-withdraw]")).toBe(null);
    expect(find(panel, "[data-qsb-review]")).toBe(null);
  });

  test("Withdraw and Review ask for the grant in their click; a denial opens nothing", async () => {
    const denied = await account(
      {
        vaults: {
          resolve: reading([depositedVault(0, "confirmed"), withdrawingVault(1, "ready")]),
        },
      },
      false,
      false,
    );
    find<HTMLButtonElement>(denied, '[data-qsb-withdraw="0"]')?.click();
    find<HTMLButtonElement>(denied, '[data-qsb-review="1"]')?.click();
    expect(denied.permissions.asked).toHaveLength(2);
    await flush();
    expect(denied.visited).toEqual(["qsb-account"]);
    expect(find(denied, "#qsb-vault-result")?.textContent).toBe(
      "Allow Bramble to reach the QSB service to continue.",
    );
    const granted = await account(
      { vaults: { resolve: reading([withdrawingVault(1, "ready")]) } },
      false,
      true,
    );
    find<HTMLButtonElement>(granted, '[data-qsb-review="1"]')?.click();
    await flush();
    expect(granted.visited).toEqual(["qsb-account", "qsb-release"]);
  });

  test("Resend sends the same withdrawal once and says how it went", async () => {
    const resent = deferred<ReturnType<typeof withdrawalResult>>();
    const panel = await account({
      vaults: { resolve: reading([withdrawingVault(0, "uncertain")]) },
      withdrawalResend: { wait: resent.promise },
    });
    find<HTMLButtonElement>(panel, '[data-qsb-resend-withdrawal="0"]')?.click();
    expect(find<HTMLButtonElement>(panel, '[data-qsb-resend-withdrawal="0"]')?.disabled).toBe(true);
    find<HTMLButtonElement>(panel, '[data-qsb-resend-withdrawal="0"]')?.click();
    expect(panel.calls.withdrawalResend).toEqual([["qsb-2", 0]]);
    resent.resolve(withdrawalResult(0, "submitted"));
    await flush();
    expect(find(panel, "#qsb-vault-result")?.textContent).toBe(
      "Withdrawal sent. It shows as withdrawn once it's mined.",
    );
    expect(text(row(panel, 0))).toContain("Withdrawal sent");
  });

  test("the poll keeps running while a withdrawal moves on its own, and stops after", async () => {
    for (const status of ["searching", "pending", "uncertain", "submitted"] as const) {
      const panel = await account({ vaults: { resolve: reading([withdrawingVault(0, status)]) } });
      expect(panel.timers.pending()).toBe(1);
      panel.journey.bind(null);
    }
    for (const status of ["paused", "failed", "ready", "confirmed", "conflict"] as const) {
      const panel = await account({ vaults: { resolve: reading([withdrawingVault(0, status)]) } });
      expect(panel.timers.pending()).toBe(0);
    }
    const panel = await account({
      vaults: { resolve: reading([withdrawingVault(0, "searching")]) },
    });
    panel.script.vaults = { resolve: reading([withdrawingVault(0, "ready")]) };
    panel.timers.advance(QSB_VAULT_POLL_MS);
    await flush();
    expect(text(row(panel, 0))).toContain("Ready to release");
    expect(panel.timers.pending()).toBe(0);
  });
});

describe("the Withdraw flow", () => {
  test("opens on the destination, named for its deposit", async () => {
    const panel = await withdraw({});
    expect(panel.visited).toEqual(["qsb-account", "qsb-withdraw"]);
    expect(step(panel)).toBe("destination");
    expect(find(panel, "#qsb-withdraw-vault")?.textContent).toBe("QSB vault 2 · Deposit 1");
    expect(document.activeElement?.getAttribute("name")).toBe("qsbDestination");
  });

  test("refuses what is not a mainnet address before any quote", async () => {
    const panel = await withdraw({});
    for (const typed of ["", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", "0x1234", "bc1q"]) {
      await toSummary(panel, typed);
      expect(find(panel, "#qsb-destination-result")?.textContent).toBe(
        "Enter a Bitcoin mainnet address.",
      );
    }
    expect(panel.calls.withdrawalQuote).toEqual([]);
    // An all-uppercase bech32 address is the same address.
    await toSummary(panel, ` ${DESTINATION.toUpperCase()} `);
    expect(panel.calls.withdrawalQuote).toEqual([["qsb-2", 0, DESTINATION]]);
  });

  test("sums what the destination receives and waits for the costs to be accepted", async () => {
    const panel = await withdraw({});
    await toSummary(panel);
    expect(step(panel)).toBe("summary");
    expect(text(find(panel, "#qsb-withdraw-quote"))).toBe(
      "Deposit 0.00100000 BTC From your balance + 0.00010000 BTC Network fee − 0.00000900 BTC " +
        `You receive 0.00109100 BTC To ${DESTINATION} Fee rate 4 sat/vB`,
    );
    expect(text(find(panel, '[data-qsb-withdraw-step="summary"]'))).toContain(
      "This can take hours, and the fee can't change later.",
    );
    expect(startButton(panel)?.disabled).toBe(true);
    submitForm(find<HTMLFormElement>(panel, "#qsb-withdraw-form"));
    expect(panel.calls.withdrawalStart).toEqual([]);
    accept(panel);
    expect(startButton(panel)?.disabled).toBe(false);
  });

  test("starts once with the quote's own fee, then goes back to the QSB vault", async () => {
    const started = deferred<ReturnType<typeof withdrawingVault>>();
    const panel = await withdraw({ withdrawalStart: { wait: started.promise } });
    await toSummary(panel);
    accept(panel);
    submitForm(find<HTMLFormElement>(panel, "#qsb-withdraw-form"));
    submitForm(find<HTMLFormElement>(panel, "#qsb-withdraw-form"));
    expect(step(panel)).toBe("starting");
    // Leaving and coming back reattaches to the same start.
    panel.paint("qsb-withdraw");
    expect(step(panel)).toBe("starting");
    expect(panel.calls.withdrawalStart).toEqual([["qsb-2", 0, DESTINATION, 900]]);
    panel.script.vaults = { resolve: reading([withdrawingVault(0, "searching")]) };
    started.resolve(withdrawingVault(0, "searching"));
    await flush();
    await flush();
    expect(panel.app().querySelector("#qsb-account")).not.toBe(null);
    expect(text(row(panel, 0))).toContain("Withdrawing This can take hours.");
  });

  test("a changed quote is quoted again and asked again", async () => {
    const panel = await withdraw({
      withdrawalStart: { reject: new Error(QSB_WITHDRAWAL_REFUSALS.quoteChanged) },
    });
    await toSummary(panel);
    accept(panel);
    panel.script.withdrawalQuote = {
      resolve: { ...WITHDRAWAL_QUOTE, feeRate: "6", feeSat: 1_350, outputSat: 108_650 },
    };
    submitForm(find<HTMLFormElement>(panel, "#qsb-withdraw-form"));
    await flush();
    await flush();
    expect(step(panel)).toBe("summary");
    expect(find(panel, "#qsb-withdraw-result")?.textContent).toBe(
      "The cost changed. Review the new quote.",
    );
    expect(text(find(panel, "#qsb-withdraw-quote"))).toContain("You receive 0.00108650 BTC");
    expect(startButton(panel)?.disabled).toBe(true);
  });

  test("a refusal keeps the summary; a lost reply never reads as failed", async () => {
    const refused = await withdraw({
      withdrawalStart: { reject: new Error(QSB_WITHDRAWAL_REFUSALS.helperNeeded) },
    });
    await toSummary(refused);
    accept(refused);
    submitForm(find<HTMLFormElement>(refused, "#qsb-withdraw-form"));
    await flush();
    expect(step(refused)).toBe("summary");
    expect(find(refused, "#qsb-withdraw-result")?.textContent).toBe(
      "Send a little bitcoin to this QSB vault's address and wait for it to confirm.",
    );
    const lost = await withdraw({
      withdrawalStart: { reject: new SubmissionUnknownError("lost", null) },
    });
    await toSummary(lost);
    accept(lost);
    submitForm(find<HTMLFormElement>(lost, "#qsb-withdraw-form"));
    await flush();
    expect(step(lost)).toBe("unavailable");
    expect(find(lost, "#qsb-withdraw-error")?.textContent).toBe(
      "Bramble couldn't confirm this finished. Refresh before trying again.",
    );
    expect(find<HTMLButtonElement>(lost, "#qsb-withdraw-retry")?.hidden).toBe(true);
  });

  test("a deposit that can't be withdrawn says so; leaving empties the address", async () => {
    const panel = qsbPanel({
      list: { resolve: [QSB_VIEWS.ready] },
      vaults: { resolve: reading([withdrawingVault(0, "searching")]) },
    });
    panel.journey.openWithdraw("qsb-2", 0);
    await flush();
    expect(step(panel)).toBe("unavailable");
    expect(find(panel, "#qsb-withdraw-error")?.textContent).toBe(
      "This deposit can't be withdrawn.",
    );
    const open = await withdraw({});
    const input = find<HTMLInputElement>(open, 'input[name="qsbDestination"]');
    typeInto(input, DESTINATION);
    open.journey.bind(null);
    expect(input?.value).toBe("");
  });
});
