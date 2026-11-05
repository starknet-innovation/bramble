/**
 * QSB withdrawal checkpoints: a QSB vault's deposits in every withdrawal
 * state; the Withdraw flow from the destination through its refusals, the
 * summary and the start; and the release review with its unverified-binding
 * warning, the passphrase, sending and every outcome. Production templates and
 * bindings run against a fixture client with inert timers; nothing is
 * disclosed or sent.
 */

import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import {
  deposited,
  labReading,
  QSB_LAB_ACCOUNTS,
  type QsbLabScript,
  ungrantedReading,
} from "../fixtures/qsb-vault-fixtures";
import {
  EVERY_WITHDRAWAL,
  LAB_DESTINATION,
  labReview,
  releaseOutcome,
  WITHDRAWAL_QUOTE,
  withdrawing,
} from "../fixtures/qsb-withdrawal-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import { nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";
import { qsbLabJourney } from "./scenarios-qsb-vaults";

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const submit = (context: FrameContext, selector: string): void => {
  const form = context.app.querySelector<HTMLFormElement>(selector);
  const view = context.document.defaultView;
  if (!form || !view) throw new Error(`Missing QSB form ${selector}`);
  form.dispatchEvent(new view.Event("submit", { bubbles: true, cancelable: true }));
};

const tick = (context: FrameContext, name: string): void => {
  const box = context.app.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  const view = context.document.defaultView;
  if (!box || !view) throw new Error(`Missing QSB checkbox ${name}`);
  box.checked = true;
  box.dispatchEvent(new view.Event("change", { bubbles: true }));
};

const settle = async (): Promise<void> => {
  await nextTurn();
  await nextTurn();
};

type WithdrawStage = "accepted" | "destination" | "start" | "summary";

// Drives the production Withdraw binding for deposit 1 to `stage`.
const withdrawTo = async (
  context: FrameContext,
  script: QsbLabScript,
  stage: WithdrawStage,
  typed = LAB_DESTINATION,
): Promise<void> => {
  const journey = qsbLabJourney(context, {
    reading: async () => labReading([deposited(0, "confirmed")]),
    withdrawalQuote: async () => WITHDRAWAL_QUOTE,
    ...script,
  });
  journey.openWithdraw(QSB_LAB_ACCOUNTS.ready.id, 0);
  journey.bind(context.app);
  await settle();
  if (stage === "destination" && typed === "") return;
  updateForm(context, 'input[name="qsbDestination"]', typed);
  submit(context, "#qsb-destination-form");
  await settle();
  if (stage === "destination" || stage === "summary") return;
  tick(context, "qsbWithdrawAccept");
  if (stage === "accepted") return;
  submit(context, "#qsb-withdraw-form");
  await settle();
};

// Drives the production Release binding for deposit 4 (a ready withdrawal).
const releaseTo = async (
  context: FrameContext,
  script: QsbLabScript,
  send: boolean,
): Promise<void> => {
  const journey = qsbLabJourney(context, {
    reading: async () => labReading([withdrawing(3, "ready")]),
    review: async () => labReview(3),
    ...script,
  });
  journey.openRelease(QSB_LAB_ACCOUNTS.ready.id, 3);
  journey.bind(context.app);
  await settle();
  if (!send) return;
  updateForm(context, 'input[name="walletPassphrase"]', "fixture passphrase");
  submit(context, "#qsb-release-form");
  await settle();
};

const checkpoint = (
  view: "qsb-account" | "qsb-release" | "qsb-withdraw",
  id: string,
  label: string,
  narrative: string,
  state: Readonly<Record<string, unknown>>,
  run: (context: FrameContext) => Promise<void>,
): ScenarioCheckpoint => ({
  content: () => walletDashboard({ view }),
  id,
  label,
  narrative,
  prepare: run,
  state,
});

const withdrawCheckpoint = (
  id: string,
  label: string,
  narrative: string,
  state: Readonly<Record<string, unknown>>,
  run: (context: FrameContext) => Promise<void>,
) => checkpoint("qsb-withdraw", id, label, narrative, state, run);

const releaseCheckpoint = (
  id: string,
  label: string,
  narrative: string,
  state: Readonly<Record<string, unknown>>,
  run: (context: FrameContext) => Promise<void>,
) => checkpoint("qsb-release", id, label, narrative, state, run);

/** The withdrawal family: rows, the Withdraw flow and the release review. */
export const qsbWithdrawScenario: WalletScenario = {
  checkpoints: [
    checkpoint(
      "qsb-account",
      "qsb-withdrawals-rows",
      "Deposits · every withdrawal state",
      "One row per withdrawal state: Withdrawing (it can take hours), Withdrawal paused, Withdrawal failed (its bitcoin stays locked), Ready to release (Review), Sending, Withdrawal sent (linked), Not confirmed yet (Resend), Withdrawn with its confirmations, and Spent elsewhere.",
      { rows: 9 },
      async (context) => {
        const journey = qsbLabJourney(context, {
          reading: async () => labReading(EVERY_WITHDRAWAL),
        });
        journey.openAccount(QSB_LAB_ACCOUNTS.ready.id);
        journey.bind(context.app);
        await settle();
      },
    ),
    checkpoint(
      "qsb-account",
      "qsb-withdrawals-funded",
      "Deposits · Withdraw",
      "A funded deposit with nothing started offers Withdraw to a writer, gated on the QSB service's grant as Fund is.",
      { action: "withdraw" },
      async (context) => {
        const journey = qsbLabJourney(context, {
          reading: async () => labReading([deposited(0, "confirmed"), withdrawing(1, "searching")]),
        });
        journey.openAccount(QSB_LAB_ACCOUNTS.ready.id);
        journey.bind(context.app);
        await settle();
      },
    ),
    withdrawCheckpoint(
      "qsb-withdraw-destination",
      "Withdraw · destination",
      "The destination address, for the one deposit named above it.",
      { step: "destination" },
      (context) => withdrawTo(context, {}, "destination", ""),
    ),
    withdrawCheckpoint(
      "qsb-withdraw-invalid",
      "Withdraw · not an address",
      "Anything that does not read as a Bitcoin mainnet address is refused before any quote.",
      { quote: "not asked" },
      (context) =>
        withdrawTo(context, {}, "destination", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"),
    ),
    withdrawCheckpoint(
      "qsb-withdraw-helper",
      "Withdraw · helper needed",
      "The quote's refusal: send a little bitcoin to the QSB vault's own address and wait for it to confirm.",
      { refusal: "helper needed" },
      (context) =>
        withdrawTo(
          context,
          {
            withdrawalQuote: () => Promise.reject(new Error(QSB_WITHDRAWAL_REFUSALS.helperNeeded)),
          },
          "summary",
        ),
    ),
    withdrawCheckpoint(
      "qsb-withdraw-summary",
      "Withdraw · summary",
      "What the destination receives as a sum (deposit, plus the helper from your address, less the network fee), the full destination, the fee rate, and the one line that the search can take hours and the fee can't change later.",
      { accepted: false, startEnabled: false },
      (context) => withdrawTo(context, {}, "summary"),
    ),
    withdrawCheckpoint(
      "qsb-withdraw-accepted",
      "Withdraw · costs accepted",
      "Ticking the costs enables Start withdrawal; a new quote clears the tick.",
      { accepted: true, startEnabled: true },
      (context) => withdrawTo(context, {}, "accepted"),
    ),
    withdrawCheckpoint(
      "qsb-withdraw-starting",
      "Withdraw · starting",
      "The withdrawal is fixed at the quote's own fee and its search started; a second tap or coming back only reattaches. It then goes back to the QSB vault.",
      { start: "in flight" },
      (context) => withdrawTo(context, { startWithdrawal: never }, "start"),
    ),
    withdrawCheckpoint(
      "qsb-withdraw-quote-changed",
      "Withdraw · cost changed",
      "The cost moved after the summary: the screen quotes again and asks again, with the tick cleared.",
      { refusal: "quote changed" },
      async (context) => {
        let quotes = 0;
        await withdrawTo(
          context,
          {
            startWithdrawal: () => Promise.reject(new Error(QSB_WITHDRAWAL_REFUSALS.quoteChanged)),
            withdrawalQuote: async () => {
              quotes += 1;
              return quotes === 1
                ? WITHDRAWAL_QUOTE
                : { ...WITHDRAWAL_QUOTE, feeRate: "6", feeSat: 1_350, outputSat: 108_650 };
            },
          },
          "start",
        );
      },
    ),
    withdrawCheckpoint(
      "qsb-withdraw-access",
      "Withdraw · access not granted",
      "Without the QSB service's grant nothing can be quoted, so Allow access stands in place of the address.",
      { access: "not granted" },
      (context) =>
        withdrawTo(
          context,
          {
            access: { answer: false, granted: false },
            reading: async () => ungrantedReading([deposited(0, "confirmed")]),
          },
          "destination",
          "",
        ),
    ),
    releaseCheckpoint(
      "qsb-release-review",
      "Release · review",
      "What the BIP requires before any secret leaves, under the prominent warning that the transaction binding is unverified: the network, which deposit, the 15 one-time keys, the full destination, what it receives, and the network fee and size. Then the wallet passphrase.",
      { binding: "unverified", keys: 15 },
      (context) => releaseTo(context, {}, false),
    ),
    releaseCheckpoint(
      "qsb-release-mismatch",
      "Release · doesn't check out",
      "A review that disagrees with the deposit's own withdrawal (here, another destination) offers no release.",
      { release: "refused" },
      (context) =>
        releaseTo(
          context,
          {
            review: async () => ({
              ...labReview(3),
              destination: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
            }),
          },
          false,
        ),
    ),
    releaseCheckpoint(
      "qsb-release-refused",
      "Release · refused",
      "A refusal released nothing: the review stays, the passphrase field is empty, and the line says why.",
      { released: "nothing" },
      (context) =>
        releaseTo(
          context,
          { release: () => Promise.reject(new Error(QSB_WITHDRAWAL_REFUSALS.floorRisen)) },
          true,
        ),
    ),
    releaseCheckpoint(
      "qsb-release-sending",
      "Release · sending",
      "The keys are released, the withdrawal signed and submitted; a second tap or coming back only reattaches.",
      { release: "in flight" },
      (context) => releaseTo(context, { release: never }, true),
    ),
    releaseCheckpoint(
      "qsb-release-sent",
      "Release · sent",
      "MARA has the withdrawal; its txid links to mempool.space.",
      { submission: "submitted" },
      (context) =>
        releaseTo(context, { release: async () => releaseOutcome(3, "submitted") }, true),
    ),
    releaseCheckpoint(
      "qsb-release-uncertain",
      "Release · not confirmed yet",
      "The service could not say whether MARA has it; Resend sends the same withdrawal again.",
      { submission: "uncertain" },
      (context) =>
        releaseTo(context, { release: async () => releaseOutcome(3, "uncertain") }, true),
    ),
    releaseCheckpoint(
      "qsb-release-confirmed",
      "Release · withdrawn",
      "The withdrawal is mined.",
      { submission: "confirmed" },
      (context) =>
        releaseTo(context, { release: async () => releaseOutcome(3, "confirmed") }, true),
    ),
    releaseCheckpoint(
      "qsb-release-conflict",
      "Release · conflict",
      "Another transaction spent the deposit: the screen says so and offers no Resend.",
      { submission: "conflict" },
      (context) => releaseTo(context, { release: async () => releaseOutcome(3, "conflict") }, true),
    ),
    releaseCheckpoint(
      "qsb-release-changed",
      "Release · review changed",
      "The withdrawal changed after the review: it is fetched again and shown again, and the passphrase is asked again.",
      { refusal: "review changed" },
      (context) =>
        releaseTo(
          context,
          { release: () => Promise.reject(new Error(QSB_WITHDRAWAL_REFUSALS.reviewChanged)) },
          true,
        ),
    ),
    releaseCheckpoint(
      "qsb-release-unknown",
      "Release · status unknown",
      "The reply was lost: the outcome is unknown, and the screen offers no second release.",
      { submission: "unknown" },
      (context) =>
        releaseTo(
          context,
          { release: () => Promise.reject(new Error("wallet request failed")) },
          true,
        ),
    ),
    releaseCheckpoint(
      "qsb-release-access",
      "Release · access not granted",
      "Without the QSB service's grant there is nothing to review yet, so Allow access stands in its place.",
      { access: "not granted" },
      (context) =>
        releaseTo(
          context,
          {
            access: { answer: false, granted: false },
            reading: async () => ungrantedReading([withdrawing(3, "ready")]),
          },
          false,
        ),
    ),
    releaseCheckpoint(
      "qsb-release-not-ready",
      "Release · not ready",
      "A withdrawal still searching has nothing to release yet.",
      { status: "searching" },
      (context) =>
        releaseTo(
          context,
          { reading: async () => labReading([withdrawing(3, "searching")]) },
          false,
        ),
    ),
  ],
  description:
    "Withdrawing a QSB deposit: every withdrawal state on its row, the Withdraw flow, and the release review.",
  id: "qsb-withdrawals",
  surface: "sidepanel",
  title: "QSB withdrawals",
  views: ["qsb-withdraw", "qsb-release"],
};
