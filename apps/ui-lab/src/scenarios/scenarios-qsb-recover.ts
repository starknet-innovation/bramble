/**
 * QSB recovery checkpoints: a read-only QSB vault (an imported phrase whose
 * creating install is gone) offering Recover deposits, the step that says it
 * is outside custody conformance, the recovery running, the recovered
 * deposits (a ready withdrawal offers Review), and the emergency release
 * review with its second warning. Production templates and bindings run
 * against a fixture client with inert timers; nothing is recovered, disclosed
 * or sent.
 */

import { labReading, QSB_LAB_ACCOUNTS, type QsbLabScript } from "../fixtures/qsb-vault-fixtures";
import { labReview, recovered } from "../fixtures/qsb-withdrawal-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import { nextTurn } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";
import { clickQsb, qsbLabJourney } from "./scenarios-qsb-vaults";

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const settle = async (): Promise<void> => {
  await nextTurn();
  await nextTurn();
};

const READ_ONLY = QSB_LAB_ACCOUNTS.readOnly;

// The recovered QSB vault: one deposit ready to release, one without a withdrawal.
const RECOVERED = [recovered(0, "ready"), recovered(1, "none")];

// Opens the read-only QSB vault over `script`, then lets `act` drive it.
const accountCheckpoint = (
  id: string,
  label: string,
  narrative: string,
  state: Readonly<Record<string, unknown>>,
  script: QsbLabScript,
  act?: (context: FrameContext) => void,
): ScenarioCheckpoint => ({
  content: () => walletDashboard({ view: "qsb-account" }),
  id,
  label,
  narrative,
  prepare: async (context) => {
    const journey = qsbLabJourney(context, { accounts: [READ_ONLY], ...script });
    journey.openAccount(READ_ONLY.id);
    journey.bind(context.app);
    await settle();
    act?.(context);
    await settle();
  },
  state,
});

const openRecover = (context: FrameContext): void => clickQsb(context, "#qsb-recover-open");

/** The recovery family: Recover deposits, its warning, and the emergency release. */
export const qsbRecoverScenario: WalletScenario = {
  checkpoints: [
    accountCheckpoint(
      "qsb-recover-offer",
      "Read-only QSB vault · Recover deposits",
      "An imported QSB vault with no deposits: the line that it can't take new deposits, and Recover deposits as the screen's main action.",
      { action: "recover", vaults: 0 },
      { reading: async () => labReading([]) },
    ),
    accountCheckpoint(
      "qsb-recover-warning",
      "Recover deposits · outside custody conformance",
      "Before anything is sent: the warning that Bramble cannot know whether another install already released keys for these deposits, and to recover only if the install that created this QSB vault is gone.",
      { custody: "emergency" },
      { reading: async () => labReading([]) },
      openRecover,
    ),
    accountCheckpoint(
      "qsb-recover-running",
      "Recover deposits · recovering",
      "The QSB service is asked for this phrase's deposits; a second tap or coming back only reattaches.",
      { recovery: "in flight" },
      { reading: async () => labReading([]), recover: never },
      (context) => {
        openRecover(context);
        clickQsb(context, "#qsb-recover-start");
      },
    ),
    accountCheckpoint(
      "qsb-recover-done",
      "Recover deposits · recovered",
      "Back on the QSB vault: a recovered deposit whose withdrawal is ready offers Review; one without a withdrawal still says Unavailable. Recover deposits stays, as a secondary action.",
      { vaults: 2 },
      { reading: async () => labReading([]), recover: async () => labReading(RECOVERED) },
      (context) => {
        openRecover(context);
        clickQsb(context, "#qsb-recover-start");
      },
    ),
    {
      content: () => walletDashboard({ view: "qsb-release" }),
      id: "qsb-release-emergency",
      label: "Release · emergency review",
      narrative:
        "A recovered deposit's release review: above the unverified-binding warning, a second one says the release is outside custody conformance, since Bramble cannot confirm that no other install released keys for this deposit.",
      prepare: async (context) => {
        const journey = qsbLabJourney(context, {
          accounts: [READ_ONLY],
          reading: async () => labReading(RECOVERED),
          review: async () => labReview(0, "emergency"),
        });
        journey.openRelease(READ_ONLY.id, 0);
        journey.bind(context.app);
        await settle();
      },
      state: { binding: "unverified", custody: "emergency" },
    },
  ],
  description:
    "Recovering a read-only QSB vault's deposits after the install that created it is gone, and their emergency release.",
  id: "qsb-recovery",
  surface: "sidepanel",
  title: "QSB recovery",
  views: ["qsb-account", "qsb-release"],
};
