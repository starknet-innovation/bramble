/**
 * A deposit into one unfunded Quantum-safe Bitcoin vault under happy-dom,
 * through the journey: the amount is checked in satoshis before any quote,
 * the review states every cost and the three facts and keeps Deposit
 * disabled until the costs are accepted, the deposit sends the quote's own
 * fee exactly once however often it is asked, and each outcome (sent, not
 * confirmed, refused, a changed quote, a lost reply) lands where it should.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
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
import { qsbPanel } from "../../../support/qsb-panel";
import {
  depositedVault,
  depositResult,
  QSB_TXID,
  QUOTE,
  reading,
  unfundedVault,
} from "../../../support/qsb-vault-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

type Panel = ReturnType<typeof qsbPanel>;

const step = (panel: Panel): string | null => shownStep(panel.app(), "data-qsb-deposit-step");
const find = <T extends Element>(panel: Panel, selector: string): T | null =>
  panel.app().querySelector<T>(selector);
const text = (panel: Panel, selector: string): string => {
  const node = find(panel, selector);
  if (!node) return "";
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const value = next.textContent?.replace(/\s+/g, " ").trim();
    if (value) parts.push(value);
  }
  return parts.join(" ");
};
const refused = (panel: Panel, selector: string): boolean =>
  find(panel, selector)?.classList.contains("is-invalid") ?? false;
const depositButton = (panel: Panel) =>
  find<HTMLButtonElement>(panel, '#qsb-review-form button[type="submit"]');
const accept = (panel: Panel): void => {
  const box = find<HTMLInputElement>(panel, 'input[name="qsbAccept"]');
  if (!box) throw new Error("missing checkbox");
  box.checked = true;
  box.dispatchEvent(new Event("change", { bubbles: true }));
};

// Opens vault 0 of the ready account from its account screen, as a tap on
// Deposit does. The panel's `script` stays live between reads.
const depositScreen = async (script: QsbScript): Promise<Panel> => {
  const panel = qsbPanel({
    list: { resolve: [QSB_VIEWS.ready] },
    vaults: { resolve: reading([unfundedVault(0)]) },
    ...script,
  });
  panel.journey.openAccount("qsb-2");
  await flush();
  find<HTMLButtonElement>(panel, '[data-qsb-deposit="0"]')?.click();
  await flush();
  return panel;
};

// Types `amount` and asks for its review.
const reviewed = async (script: QsbScript, amount = "0.001"): Promise<Panel> => {
  const panel = await depositScreen({ quote: { resolve: QUOTE }, ...script });
  typeInto(find<HTMLInputElement>(panel, 'input[name="qsbAmount"]'), amount);
  submitForm(find<HTMLFormElement>(panel, "#qsb-amount-form"));
  await flush();
  return panel;
};

describe("the deposit amount", () => {
  test("opens from Deposit with the vault named and the confirmed balance", async () => {
    const panel = await depositScreen({});
    expect(panel.visited).toEqual(["qsb-account", "qsb-deposit"]);
    expect(step(panel)).toBe("amount");
    expect(text(panel, "#qsb-deposit-vault")).toBe("Account 2 · Vault 1");
    expect(text(panel, "#qsb-amount-available")).toBe("Confirmed balance: 0.00250000 BTC");
    expect(document.activeElement?.getAttribute("name")).toBe("qsbAmount");
  });

  test("is refused before any quote when it is not an amount, too small, or over the balance", async () => {
    const panel = await depositScreen({ quote: { resolve: QUOTE } });
    const input = find<HTMLInputElement>(panel, 'input[name="qsbAmount"]');
    for (const [typed, line] of [
      ["1e-3", "Enter an amount in BTC, up to 8 decimal places."],
      ["0.000000001", "Enter an amount in BTC, up to 8 decimal places."],
      ["0.00009999", "Deposit at least 0.0001 BTC."],
      ["0.00250001", "Not enough bitcoin for this deposit and its fee."],
    ] as const) {
      typeInto(input, typed);
      submitForm(find<HTMLFormElement>(panel, "#qsb-amount-form"));
      await flush();
      expect(text(panel, "#qsb-amount-result")).toBe(line);
      expect(refused(panel, "#qsb-amount-result")).toBe(true);
      expect(step(panel)).toBe("amount");
    }
    expect(panel.calls.quote).toEqual([]);
    typeInto(input, "0.001");
    expect(text(panel, "#qsb-amount-result")).toBe("");
    expect(refused(panel, "#qsb-amount-result")).toBe(false);
  });

  test("a vault that cannot take a deposit, or a service out of reach, says so", async () => {
    const pending = await depositScreen({});
    pending.script.vaults = { resolve: reading([depositedVault(0, "pending")]) };
    pending.paint("qsb-deposit");
    await flush();
    expect(step(pending)).toBe("unavailable");
    expect(text(pending, "#qsb-deposit-error")).toBe("This vault can't take a deposit.");
    expect(find<HTMLButtonElement>(pending, "#qsb-deposit-retry")?.hidden).toBe(true);

    pending.script.vaults = { resolve: { ...reading([unfundedVault(0)]), funds: null } };
    pending.paint("qsb-deposit");
    await flush();
    // The same line the account shows, beside its own Try again.
    expect(text(pending, "#qsb-deposit-error")).toBe(
      "Can't reach the quantum-safe Bitcoin service.",
    );
    expect(find<HTMLButtonElement>(pending, "#qsb-deposit-retry")?.hidden).toBe(false);
    pending.script.vaults = { resolve: reading([unfundedVault(0)]) };
    find<HTMLButtonElement>(pending, "#qsb-deposit-retry")?.click();
    await flush();
    expect(step(pending)).toBe("amount");
  });
});

describe("the deposit review", () => {
  test("quotes the amount in satoshis and states every cost and the three facts", async () => {
    const panel = await reviewed({});
    expect(panel.calls.quote).toEqual([["qsb-2", 0, 100_000]]);
    expect(step(panel)).toBe("review");
    expect(text(panel, "#qsb-deposit-quote")).toBe(
      "Deposit 0.00100000 BTC Network fee 0.00000564 BTC Fee rate 2.5 sat/vB " +
        "Change to you 0.00149436 BTC Withdrawal fee, est. 0.00001200 BTC",
    );
    expect(text(panel, '[data-qsb-deposit-step="review"] .review-panel')).toBe(
      "A vault takes one deposit. " +
        "The deposit goes through the quantum-safe Bitcoin service to MARA Slipstream. " +
        "The quantum-safe Bitcoin service is not a production release.",
    );
  });

  test("Deposit stays disabled until the costs are accepted", async () => {
    const panel = await reviewed({});
    expect(depositButton(panel)?.disabled).toBe(true);
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    expect(panel.calls.deposit).toEqual([]);
    accept(panel);
    expect(depositButton(panel)?.disabled).toBe(false);
  });

  test("a quote with no change says so", async () => {
    const panel = await reviewed({ quote: { resolve: { ...QUOTE, changeSat: 0 } } });
    expect(text(panel, "#qsb-deposit-quote")).toContain("Change to you None");
  });

  test("Change amount goes back with the amount kept and the acceptance dropped", async () => {
    const panel = await reviewed({});
    accept(panel);
    find<HTMLButtonElement>(panel, "#qsb-review-back")?.click();
    expect(step(panel)).toBe("amount");
    expect(find<HTMLInputElement>(panel, 'input[name="qsbAmount"]')?.value).toBe("0.001");
    expect(find<HTMLInputElement>(panel, 'input[name="qsbAccept"]')?.checked).toBe(false);
  });
});

describe("submitting a deposit", () => {
  test("sends the quote's own fee once, however often it is asked, and shows it sent", async () => {
    const sent = deferred<ReturnType<typeof depositResult>>();
    const panel = await reviewed({ deposit: { wait: sent.promise } });
    accept(panel);
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    expect(step(panel)).toBe("sending");
    expect(text(panel, '[data-qsb-deposit-step="sending"]')).toBe("Sending deposit…");
    // Leaving and coming back reattaches to the same deposit.
    panel.paint("qsb-account");
    await flush();
    expect(find<HTMLButtonElement>(panel, '[data-qsb-deposit="0"]')?.disabled).toBe(true);
    panel.paint("qsb-deposit");
    expect(step(panel)).toBe("sending");
    expect(panel.calls.deposit).toEqual([["qsb-2", 0, 100_000, 564]]);
    sent.resolve(depositResult(0, "submitted"));
    await flush();
    expect(step(panel)).toBe("outcome");
    expect(text(panel, "#qsb-outcome-title")).toBe("Deposit sent");
    expect(text(panel, "#qsb-outcome-line")).toBe("The vault shows as funded once it's mined.");
    const link = find<HTMLAnchorElement>(panel, "#qsb-outcome-tx");
    expect(link?.hidden).toBe(false);
    expect(link?.getAttribute("href")).toBe(`https://mempool.space/tx/${QSB_TXID}`);
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(find<HTMLButtonElement>(panel, "#qsb-outcome-resend")?.hidden).toBe(true);
  });

  test("not confirmed yet offers Resend, which resends once", async () => {
    const panel = await reviewed({ deposit: { resolve: depositResult(0, "uncertain") } });
    accept(panel);
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    await flush();
    expect(text(panel, "#qsb-outcome-title")).toBe("Not confirmed yet");
    expect(text(panel, "#qsb-outcome-line")).toBe("Resend sends the same transaction again.");
    // A pending deposit is not on the network yet: no link.
    expect(find<HTMLAnchorElement>(panel, "#qsb-outcome-tx")?.hidden).toBe(true);
    const resend = find<HTMLButtonElement>(panel, "#qsb-outcome-resend");
    expect(resend?.hidden).toBe(false);
    panel.script.resend = { resolve: depositResult(0, "submitted") };
    resend?.click();
    await flush();
    expect(panel.calls.resend).toEqual([["qsb-2", 0]]);
    expect(text(panel, "#qsb-outcome-title")).toBe("Deposit sent");
  });

  test("a refused deposit says the vault can take a new one; Done goes back", async () => {
    const panel = await reviewed({ deposit: { resolve: depositResult(0, "rejected") } });
    accept(panel);
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    await flush();
    expect(text(panel, "#qsb-outcome-title")).toBe("Deposit refused");
    expect(text(panel, "#qsb-outcome-line")).toBe(
      "MARA refused it. The vault can take a new deposit.",
    );
    find<HTMLButtonElement>(
      panel,
      '[data-qsb-deposit-step="outcome"] [data-qsb-deposit-leave]',
    )?.click();
    expect(panel.app().querySelector("#qsb-account")).not.toBe(null);
  });

  test("a changed quote is quoted again and asked again, never sent on the old tick", async () => {
    const panel = await reviewed({
      deposit: { reject: new Error(QSB_VAULT_REFUSALS.quoteChanged) },
    });
    accept(panel);
    panel.script.quote = { resolve: { ...QUOTE, feeRate: "4", feeSat: 900 } };
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    await flush();
    expect(panel.calls.quote).toEqual([
      ["qsb-2", 0, 100_000],
      ["qsb-2", 0, 100_000],
    ]);
    expect(step(panel)).toBe("review");
    expect(text(panel, "#qsb-review-result")).toBe("The cost changed. Review the new quote.");
    // A moved cost is news, not a mistake to fix.
    expect(refused(panel, "#qsb-review-result")).toBe(false);
    expect(text(panel, "#qsb-deposit-quote")).toContain(
      "Network fee 0.00000900 BTC Fee rate 4 sat/vB",
    );
    expect(depositButton(panel)?.disabled).toBe(true);
    panel.script.deposit = { resolve: depositResult(0, "submitted") };
    accept(panel);
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    await flush();
    expect(panel.calls.deposit).toEqual([
      ["qsb-2", 0, 100_000, 564],
      ["qsb-2", 0, 100_000, 900],
    ]);
  });

  test("a refusal keeps the review to decide again", async () => {
    const panel = await reviewed({
      deposit: { reject: new Error(QSB_VAULT_REFUSALS.insufficientFunds) },
    });
    accept(panel);
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    await flush();
    expect(step(panel)).toBe("review");
    expect(text(panel, "#qsb-review-result")).toBe(
      "Not enough bitcoin for this deposit and its fee.",
    );
    expect(refused(panel, "#qsb-review-result")).toBe(true);
    expect(depositButton(panel)?.disabled).toBe(false);
  });

  test("a lost reply is status unknown, with no way to send again from here", async () => {
    const panel = await reviewed({ deposit: { reject: new SubmissionUnknownError("lost", null) } });
    accept(panel);
    submitForm(find<HTMLFormElement>(panel, "#qsb-review-form"));
    await flush();
    expect(step(panel)).toBe("outcome");
    expect(text(panel, "#qsb-outcome-title")).toBe("Deposit status unknown");
    expect(text(panel, "#qsb-outcome-line")).toBe(
      "Bramble couldn't confirm this finished. Refresh the account before trying again.",
    );
    expect(find<HTMLButtonElement>(panel, "#qsb-outcome-resend")?.hidden).toBe(true);
    expect(find<HTMLAnchorElement>(panel, "#qsb-outcome-tx")?.hidden).toBe(true);
  });

  test("leaving empties the form and drops a quote still in flight", async () => {
    const quote = deferred<typeof QUOTE>();
    const panel = await depositScreen({ quote: { wait: quote.promise } });
    const input = find<HTMLInputElement>(panel, 'input[name="qsbAmount"]');
    typeInto(input, "0.001");
    submitForm(find<HTMLFormElement>(panel, "#qsb-amount-form"));
    panel.journey.bind(null);
    expect(input?.value).toBe("");
    quote.resolve(QUOTE);
    await flush();
    expect(shownStep(panel.app(), "data-qsb-deposit-step")).toBe("amount");
  });
});
