/**
 * Quantum-safe Bitcoin deposit checkpoints: the amount and its refusals, the
 * review before and after the costs are accepted, the deposit in flight, and
 * every outcome (sent, not confirmed yet, refused, a changed quote, a lost
 * reply), plus a vault whose service is out of reach. Production templates
 * and bindings run against a fixture client; nothing is signed or sent.
 */

import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import {
  labReading,
  outcome,
  QSB_LAB_ACCOUNTS,
  type QsbLabScript,
  QUOTE,
  unfunded,
  ungrantedReading,
} from "../fixtures/qsb-vault-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import { nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";
import { clickQsb, qsbLabJourney } from "./scenarios-qsb-vaults";

type Stage = "accepted" | "amount" | "review" | "sent";

const submit = (context: FrameContext, selector: string): void => {
  const form = context.app.querySelector<HTMLFormElement>(selector);
  const view = context.document.defaultView;
  if (!form || !view) throw new Error(`Missing QSB form ${selector}`);
  form.dispatchEvent(new view.Event("submit", { bubbles: true, cancelable: true }));
};

const tick = (context: FrameContext): void => {
  const box = context.app.querySelector<HTMLInputElement>('input[name="qsbAccept"]');
  const view = context.document.defaultView;
  if (!box || !view) throw new Error("Missing QSB acceptance");
  box.checked = true;
  box.dispatchEvent(new view.Event("change", { bubbles: true }));
};

// Drives the production deposit binding to `stage` with `amount` typed.
const depositTo = async (
  context: FrameContext,
  script: QsbLabScript,
  stage: Stage,
  amount = "0.001",
): Promise<void> => {
  const journey = qsbLabJourney(context, {
    reading: async () => labReading([unfunded(0)]),
    ...script,
  });
  journey.openDeposit(QSB_LAB_ACCOUNTS.ready.id, 0);
  journey.bind(context.app);
  await nextTurn();
  if (stage === "amount" && amount === "") return;
  updateForm(context, 'input[name="qsbAmount"]', amount);
  submit(context, "#qsb-amount-form");
  await nextTurn();
  if (stage === "amount" || stage === "review") return;
  tick(context);
  if (stage === "accepted") return;
  submit(context, "#qsb-review-form");
  await nextTurn();
  await nextTurn();
};

const depositCheckpoint = (
  id: string,
  label: string,
  narrative: string,
  state: Readonly<Record<string, unknown>>,
  run: (context: FrameContext) => Promise<void>,
): ScenarioCheckpoint => ({
  content: () => walletDashboard({ view: "qsb-deposit" }),
  id,
  label,
  narrative,
  prepare: run,
  state,
});

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** The deposit family: amount, review, submission and its outcomes. */
export const qsbDepositScenario: WalletScenario = {
  checkpoints: [
    depositCheckpoint(
      "qsb-deposit-amount",
      "Deposit · amount",
      "The amount in BTC, beside the confirmed balance it is checked against.",
      { balance: "0.0025 BTC" },
      (context) => depositTo(context, {}, "amount", ""),
    ),
    depositCheckpoint(
      "qsb-deposit-amount-refused",
      "Deposit · over the balance",
      "An amount over the confirmed balance is refused before any quote, in the same words the background uses.",
      { quote: "not asked" },
      (context) => depositTo(context, {}, "amount", "0.01"),
    ),
    depositCheckpoint(
      "qsb-deposit-review",
      "Deposit · review",
      "Every cost from the quote — amount, network fee and rate, change back to the owner address, the later withdrawal fee — and the three facts. Deposit waits for the costs to be accepted.",
      { accepted: false, depositEnabled: false },
      (context) => depositTo(context, {}, "review"),
    ),
    depositCheckpoint(
      "qsb-deposit-accepted",
      "Deposit · costs accepted",
      "Ticking the costs enables Deposit; a new quote clears the tick.",
      { accepted: true, depositEnabled: true },
      (context) => depositTo(context, {}, "accepted"),
    ),
    depositCheckpoint(
      "qsb-deposit-sending",
      "Deposit · sending",
      "The deposit is built, signed and submitted at the quote's own fee; a second tap or coming back only reattaches to it.",
      { submission: "in flight" },
      (context) => depositTo(context, { deposit: never }, "sent"),
    ),
    depositCheckpoint(
      "qsb-deposit-sent",
      "Deposit · sent",
      "MARA has the deposit; its txid links to mempool.space.",
      { submission: "submitted" },
      (context) => depositTo(context, { deposit: async () => outcome(0, "submitted") }, "sent"),
    ),
    depositCheckpoint(
      "qsb-deposit-uncertain",
      "Deposit · not confirmed yet",
      "The service did not confirm it has the deposit; Resend sends the same transaction again.",
      { submission: "uncertain" },
      (context) => depositTo(context, { deposit: async () => outcome(0, "uncertain") }, "sent"),
    ),
    depositCheckpoint(
      "qsb-deposit-rejected",
      "Deposit · refused",
      "MARA refused the deposit; the vault is unfunded again and can take a new one.",
      { submission: "rejected" },
      (context) => depositTo(context, { deposit: async () => outcome(0, "rejected") }, "sent"),
    ),
    depositCheckpoint(
      "qsb-deposit-quote-changed",
      "Deposit · cost changed",
      "The cost moved after the review: the screen quotes again and asks again, with the tick cleared.",
      { refusal: "quote changed" },
      async (context) => {
        let quotes = 0;
        await depositTo(
          context,
          {
            deposit: () => Promise.reject(new Error(QSB_VAULT_REFUSALS.quoteChanged)),
            quote: async () => {
              quotes += 1;
              return quotes === 1 ? QUOTE : { ...QUOTE, feeRate: "4", feeSat: 900 };
            },
          },
          "sent",
        );
      },
    ),
    depositCheckpoint(
      "qsb-deposit-unknown",
      "Deposit · status unknown",
      "The reply was lost: the screen says the outcome is unknown and offers no second send.",
      { submission: "unknown" },
      (context) =>
        depositTo(
          context,
          { deposit: () => Promise.reject(new Error("wallet request failed")) },
          "sent",
        ),
    ),
    depositCheckpoint(
      "qsb-deposit-offline",
      "Deposit · service out of reach",
      "Without the confirmed balance no amount can be checked, so the screen says why and offers Try again.",
      { funds: null },
      (context) =>
        depositTo(
          context,
          { reading: async () => ({ ...labReading([unfunded(0)]), funds: null }) },
          "amount",
          "",
        ),
    ),
    depositCheckpoint(
      "qsb-deposit-access",
      "Deposit · access not granted",
      "Without the coordinator grant the balance is unknown, so Allow access stands in place of the amount and asks in its own click.",
      { access: "not granted" },
      (context) =>
        depositTo(
          context,
          {
            access: { answer: false, granted: false },
            reading: async () => ungrantedReading([unfunded(0)]),
          },
          "amount",
          "",
        ),
    ),
    depositCheckpoint(
      "qsb-deposit-resend",
      "Deposit · resent",
      "Resend from the not-confirmed outcome sends once and reports the new outcome.",
      { submission: "submitted" },
      async (context) => {
        await depositTo(
          context,
          {
            deposit: async () => outcome(0, "uncertain"),
            resend: async () => outcome(0, "submitted"),
          },
          "sent",
        );
        clickQsb(context, "#qsb-outcome-resend");
        await nextTurn();
      },
    ),
  ],
  description:
    "A deposit into one quantum-safe Bitcoin vault: amount, review, submission and every outcome.",
  id: "qsb-deposit",
  surface: "sidepanel",
  title: "Quantum-safe Bitcoin deposit",
  views: ["qsb-deposit"],
};
