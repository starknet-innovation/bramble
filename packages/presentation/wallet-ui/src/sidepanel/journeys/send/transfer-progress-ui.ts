/**
 * Send-journey progress presentation: stage stepper, working-screen task
 * list, and per-stage copy. Split from ./transfer-ui to keep both under the
 * size budget; pure DOM writes, no wallet access.
 */

import { setFlowStep } from "../../shared/parts";
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
  progress?.removeAttribute("hidden");
  // Three steps: naming the recipient, naming the amount, then Confirm, which
  // holds everything from the review through authorizing, broadcasting and the
  // chain's own confirmation — one step for one act, rather than a rail that
  // keeps moving while the user has nothing left to do.
  const activeIndex = stage === "recipient" ? 0 : stage === "details" ? 1 : 2;
  setFlowStep(form, "data-send-step", activeIndex);
};

/**
 * What the working screen says while a reviewed send is being submitted: one
 * line, and a second only where the reader has something to do. The wallet's
 * own steps — authorizing, broadcasting, waiting for the chain — are not a
 * progress report the user acts on, so they are one wait rather than three.
 */
export type WorkingStatus = {
  /** Only set where the reader must act, such as approving on a Ledger. */
  readonly copy: string;
  readonly title: string;
};

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

// The wait between Review and the review itself, for a pool route. Nothing is
// The wait before the review lands, for a pool route. Nothing is signed or sent
// here and going back discards the preparation, but neither is worth a paragraph
// on a screen that exists for a second or two.
const preparingStatus = (): WorkingStatus => ({
  copy: "",
  title: "Preparing private transfer…",
});

/**
 * The working screen's one line, and the instruction that goes with it where
 * there is one.
 *
 * A software send says the same thing from the moment Confirm is pressed until
 * the chain answers: the wallet is sending. A Ledger send does not — the device
 * is waiting for a human, and that has to be said. A relayed route proving at
 * confirm says so too, because the wait is long enough to look stuck.
 */
export const workingStatus = <Review>(
  state: TransferState<Review>,
  mode: TransferMode = "send",
): WorkingStatus => {
  if (state.stage === "reviewing") {
    return preparingStatus();
  }
  // Only while the device still holds the request. Verified approval moves the
  // stage on, and the job reports the same through its phase; past either,
  // pointing the reader back at the Ledger is wrong.
  if (state.fields?.signer === "ledger" && state.stage === "authorizing" && !isHandingOn(state)) {
    return {
      copy: "Review the request on your Ledger. Nothing broadcasts until device approval is verified.",
      title: "Waiting for your Ledger",
    };
  }
  if (proofLeg(state.fields) === "confirm" && !isHandingOn(state)) {
    return { copy: PROVING_HINT, title: "Proving privately" };
  }
  return { copy: "", title: `${transferModeCopy(mode).progressive} your transaction…` };
};

// Phases the execute job reports once the transaction has left the signing or
// proving step and is on its way to the network or the relay.
const HANDING_ON_PHASES: ReadonlySet<string> = new Set(["broadcasting", "relaying privately"]);

const isHandingOn = <Review>(state: TransferState<Review>): boolean =>
  state.stage === "authorizing" &&
  state.progress?.phase !== undefined &&
  HANDING_ON_PHASES.has(state.progress.phase);
