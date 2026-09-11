/**
 * Send-journey progress presentation: stage stepper, working-screen task
 * list, and per-stage copy. Split from ./transfer-ui to keep both under the
 * size budget; pure DOM writes, no wallet access.
 */

import { preparationProgressText } from "../privacy/privacy-preparation-job";
import { PROVING_HINT } from "../privacy/privacy-views";
import { type TransferMode, transferModeCopy } from "./transfer-mode";
import type { TransferFields, TransferStage, TransferState } from "./transfer-model";
import { transferRoute } from "./transfer-route";

/**
 * Writes one element's text by id inside the given root, ignoring misses.
 */
export const setText = (root: ParentNode, id: string, text: string): void => {
  const node = root.querySelector(`#${id}`);
  if (node) {
    node.textContent = text;
  }
};

/**
 * Reflects the current stage on the compact step indicator above the form. A
 * review being prepared already belongs to the Review step: the rail moving
 * off Amount is the first sign the click was taken.
 */
export const setSendProgress = (form: HTMLFormElement, stage: TransferStage): void => {
  const progress = form.querySelector<HTMLElement>(".send-progress");
  progress?.toggleAttribute("hidden", stage === "recipient" || stage === "asset");
  const activeIndex =
    stage === "details"
      ? 0
      : stage === "review" || stage === "reviewing"
        ? 1
        : stage === "submitted"
          ? 3
          : stage === "confirming" || stage === "pending"
            ? 3
            : 2;
  form.querySelectorAll<HTMLElement>("[data-send-step]").forEach((step, index) => {
    const currentStep = step;
    currentStep.dataset["state"] =
      index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    currentStep.toggleAttribute("aria-current", index === activeIndex);
  });
};

/**
 * Copy and task states shown while a reviewed send is being submitted.
 */
export type WorkingStatus = {
  readonly copy: string;
  readonly labels: readonly [string, string, string, string];
  readonly liveness: string;
  readonly states: readonly [
    "active" | "done" | "pending",
    "active" | "done" | "pending",
    "active" | "done" | "pending",
    "active" | "done" | "pending",
  ];
  readonly title: string;
};

// Any route that spends a private balance is broadcast through the relay, so the
// progress copy follows the source bucket rather than the whole route: shielding
// is submitted by the account like any public transfer.
const isPrivate = (fields: TransferFields | null): boolean => fields?.source === "private";

// Which leg of a pool route builds the zero-knowledge proof. A deposit proves
// at review, so its network fee can be estimated on the real calls; a relayed
// route only quotes at review and proves at confirm, inside the relay hand-off.
// The background reports the phase of either wait but never its progress, so
// every proving step is an indeterminate one with honest copy — a phase and an
// elapsed time, never a percentage.
const proofLeg = (fields: TransferFields | null): "confirm" | "none" | "review" => {
  if (!fields) return "none";
  const route = transferRoute(fields);
  if (route.id === "public-public") return "none";
  return route.id === "public-private" ? "review" : "confirm";
};

// The broadcast title names the operation, so a shield in flight never reads as
// a payment leaving the account.
const broadcastTitle = (mode: TransferMode): string =>
  mode === "send" ? "Sending to Starknet" : `${transferModeCopy(mode).progressive} on Starknet`;

// The wait between Review and the review itself, for a pool route. Nothing is
// signed or sent here, so the copy says both what is running and that backing
// out is safe; the proof the background started cannot be interrupted, but an
// abandoned preparation is never executed.
const preparingStatus = <Review>(
  state: TransferState<Review>,
  mode: TransferMode,
): WorkingStatus => {
  const proving = proofLeg(state.fields) === "review";
  return {
    copy: proving
      ? "Building the private proof and estimating the network fee. Nothing is signed or sent until you confirm the review; going back discards this preparation."
      : "Checking the private balance and quoting the relay. The private proof is built after you confirm; going back discards this preparation.",
    labels: [
      proving ? "Build private proof" : "Quote private relay",
      "Review and confirm",
      proving ? "Broadcast to Starknet" : "Prove and relay privately",
      "Confirm on Starknet",
    ],
    liveness: proving ? PROVING_HINT : "Keep this panel open.",
    states: ["active", "pending", "pending", "pending"],
    title: transferModeCopy(mode).preparing,
  };
};

// The liveness line while a tracked job runs: what the job is doing and for
// how long, ahead of the standing hint. Only the two stages a job runs in read
// it, so a phase left over from the review can never label the confirmation.
// The job reports only fixed phase labels, so this is text, never markup.
const withProgress = <Review>(
  status: WorkingStatus,
  state: TransferState<Review>,
): WorkingStatus =>
  state.progress && (state.stage === "reviewing" || state.stage === "authorizing")
    ? { ...status, liveness: `${preparationProgressText(state.progress)}. ${status.liveness}` }
    : status;

/**
 * Derives the working-screen presentation for the current transfer state.
 * Pool routes carry proof-generation copy on the leg that actually proves —
 * review for a shield, confirm for a relayed send — because that wait is far
 * longer than a public fee estimate or signing step. `mode` only changes how the
 * operation is named; the task list and its states follow the route. While the
 * background job behind a pool route reports progress, the liveness line leads
 * with its phase and elapsed time.
 */
export const workingStatus = <Review>(
  state: TransferState<Review>,
  mode: TransferMode = "send",
): WorkingStatus => withProgress(workingStatusFor(state, mode), state);

const workingStatusFor = <Review>(
  state: TransferState<Review>,
  mode: TransferMode,
): WorkingStatus => {
  if (state.stage === "reviewing") {
    return preparingStatus(state, mode);
  }
  if (state.stage === "broadcasting") {
    return {
      copy: "Device approval passed verification. The locked transaction is being broadcast.",
      labels: ["Review locked", "Device verified", "Broadcast to Starknet", "Confirm on Starknet"],
      liveness: "Do not disconnect the device until broadcast completes.",
      states: ["done", "done", "active", "pending"],
      title: broadcastTitle(mode),
    };
  }
  if (state.stage === "confirming") {
    return {
      copy: isPrivate(state.fields)
        ? "The relay accepted the shielded transfer. Bramble is checking its chain status now."
        : "Starknet received the transaction. Bramble is checking its chain status now.",
      labels: ["Review locked", "Authorized", "Broadcast complete", "Confirm on Starknet"],
      liveness: "Fast confirmations often arrive in under a second.",
      states: ["done", "done", "done", "active"],
      title: "Confirming on Starknet",
    };
  }
  const ledger = state.fields?.signer === "ledger";
  const leg = proofLeg(state.fields);
  // Once the job reports it is handing the transaction on, the signing (or
  // proving) step is behind us: the list ticks it off and the next step lights.
  const handingOn = isHandingOn(state);
  if (!ledger && leg === "confirm") {
    return {
      copy: handingOn
        ? "The private proof is built. It is being handed to the private relay, which submits it for you."
        : "Building the private proof for this transfer, then handing it to the private relay. Proving cannot be interrupted once it starts.",
      labels: ["Review locked", "Build private proof", "Relay privately", "Confirm on Starknet"],
      liveness: handingOn ? "Keep this panel open." : PROVING_HINT,
      states: handingOn
        ? ["done", "done", "active", "pending"]
        : ["done", "active", "pending", "pending"],
      title: handingOn ? "Relaying privately" : "Proving privately",
    };
  }
  const relayed = isPrivate(state.fields);
  return {
    copy: ledger
      ? "Review the request on your Ledger. Nothing broadcasts until device approval is verified."
      : handingOn
        ? relayed
          ? "Signed. The transaction is being handed to the private relay."
          : "Signed. The transaction is being broadcast to Starknet."
        : leg === "review"
          ? "Signing the proof built at review, then broadcasting it from your account."
          : "The reviewed transaction is being authorized inside the wallet.",
    labels: [
      "Review locked",
      ledger ? "Approve on Ledger" : "Sign securely",
      relayed ? "Relay privately" : "Broadcast to Starknet",
      "Confirm on Starknet",
    ],
    liveness: ledger ? "The wallet is waiting for the device." : "Keep this panel open.",
    states: handingOn
      ? ["done", "done", "active", "pending"]
      : ["done", "active", "pending", "pending"],
    title: ledger
      ? "Waiting for your Ledger"
      : handingOn
        ? broadcastTitle(mode)
        : "Authorizing transaction",
  };
};

// Phases the execute job reports once the transaction has left the signing or
// proving step and is on its way to the network or the relay.
const HANDING_ON_PHASES: ReadonlySet<string> = new Set(["broadcasting", "relaying privately"]);

const isHandingOn = <Review>(state: TransferState<Review>): boolean =>
  state.stage === "authorizing" &&
  state.progress?.phase !== undefined &&
  HANDING_ON_PHASES.has(state.progress.phase);

/**
 * Updates one working-screen task row's label and progress state.
 */
export const setTaskStatus = (
  form: HTMLFormElement,
  task: "authorize" | "broadcast" | "confirm" | "review",
  label: string,
  state: "active" | "done" | "pending",
): void => {
  const row = form.querySelector<HTMLElement>(`[data-send-task="${task}"]`);
  if (row) {
    row.dataset["state"] = state;
  }
  setText(form, `send-task-${task}-label`, label);
};
