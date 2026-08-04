/**
 * Send-journey progress presentation: stage stepper, working-screen task
 * list, and per-stage copy. Split from ./transfer-ui to keep both under the
 * size budget; pure DOM writes, no wallet access.
 */

import type { TransferFields, TransferStage, TransferState } from "./transfer-model";

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
 * Reflects the current stage on the compact step indicator above the form.
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
 * Copy and task states shown while a send is being reviewed or submitted.
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

const isPrivate = (fields: TransferFields | null): boolean => fields?.privateSend === "1";

/**
 * Derives the working-screen presentation for the current transfer state.
 * Private sends carry proof-generation copy because preparation takes far
 * longer than a public fee estimate.
 */
export const workingStatus = <Review>(state: TransferState<Review>): WorkingStatus => {
  if (state.stage === "reviewing") {
    return isPrivate(state.fields)
      ? {
          copy: "Checking the recipient's registration, generating the transfer proof, and quoting the relay fee.",
          labels: ["Prepare private send", "Authorize", "Relay", "Confirm on Starknet"],
          liveness: "Proving can take a minute. Keep this panel open.",
          states: ["active", "pending", "pending", "pending"],
          title: "Preparing private send",
        }
      : {
          copy: "Validating the recipient, decoding the exact call, and estimating the fee.",
          labels: ["Validate details", "Authorize", "Broadcast", "Confirm on Starknet"],
          liveness: "This normally takes less than a second.",
          states: ["active", "pending", "pending", "pending"],
          title: "Preparing a safe review",
        };
  }
  if (state.stage === "broadcasting") {
    return {
      copy: "Device approval passed verification. The locked transaction is being broadcast.",
      labels: ["Review locked", "Device verified", "Broadcast to Starknet", "Confirm on Starknet"],
      liveness: "Do not disconnect the device until broadcast completes.",
      states: ["done", "done", "active", "pending"],
      title: "Sending to Starknet",
    };
  }
  if (state.stage === "confirming") {
    return {
      copy: isPrivate(state.fields)
        ? "The relay accepted the shielded transfer. MC Wallet is checking its chain status now."
        : "Starknet received the transaction. MC Wallet is checking its chain status now.",
      labels: ["Review locked", "Authorized", "Broadcast complete", "Confirm on Starknet"],
      liveness: "Fast confirmations often arrive in under a second.",
      states: ["done", "done", "done", "active"],
      title: "Confirming on Starknet",
    };
  }
  const ledger = state.fields?.signer === "ledger";
  return {
    copy: ledger
      ? "Review the request on your Ledger. Nothing broadcasts until device approval is verified."
      : isPrivate(state.fields)
        ? "The reviewed shielded transfer is being handed to the private relay."
        : "The reviewed transaction is being authorized inside the wallet.",
    labels: [
      "Review locked",
      ledger ? "Approve on Ledger" : "Sign securely",
      isPrivate(state.fields) ? "Relay privately" : "Broadcast to Starknet",
      "Confirm on Starknet",
    ],
    liveness: ledger ? "The wallet is waiting for the device." : "Keep this panel open.",
    states: ["done", "active", "pending", "pending"],
    title: ledger ? "Waiting for your Ledger" : "Authorizing transaction",
  };
};

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
