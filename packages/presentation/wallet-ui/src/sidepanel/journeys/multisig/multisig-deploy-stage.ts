/**
 * The multisig deployment form's stage: participants, approval, funding,
 * deploy, then submitted. The form carries its stage in a data attribute and
 * the step list mirrors it; this module is the one place that moves both, so
 * the two never disagree. DOM only, no wallet calls.
 */
import { transitionTaskStage } from "../../app/rendering/stage-transition";
import type { MULTISIG_CREATION_STEPS } from "./multisig-deploy-view";

/** A stage of the creation flow, as the step list names it. */
type CreationStage = (typeof MULTISIG_CREATION_STEPS)[number][0];
/** A creation stage, or `submitted` once the deployment has been sent. */
export type DeploymentStage = CreationStage | "submitted";
const DEPLOYMENT_STAGE_ORDER: Readonly<Record<DeploymentStage, number>> = {
  approval: 1,
  deploy: 3,
  fund: 2,
  participants: 0,
  submitted: 4,
};

/**
 * Moves the deployment form to `stage`, animating from the stage it is on and
 * marking each step complete, active or pending. `afterUpdate` runs once the
 * new stage is in place.
 */
export const setDeploymentStage = (
  form: HTMLFormElement,
  stage: DeploymentStage,
  afterUpdate?: () => void,
): void => {
  const targetForm = form;
  const previous =
    (form.dataset["deploymentStage"] as DeploymentStage | undefined) ?? "participants";
  transitionTaskStage(
    form.ownerDocument,
    previous,
    stage,
    DEPLOYMENT_STAGE_ORDER,
    "multisigDeployTransition",
    "multisigDeployTransitionId",
    () => {
      targetForm.dataset["deploymentStage"] = stage;
      targetForm
        .closest(".multisig-deploy-section")
        ?.querySelectorAll<HTMLElement>("[data-multisig-deploy-step]")
        .forEach((step) => {
          const targetStep = step;
          const index = Number(targetStep.dataset["multisigDeployStep"] ?? "0");
          const current = DEPLOYMENT_STAGE_ORDER[stage];
          targetStep.dataset["state"] =
            index < current ? "complete" : index === current ? "active" : "pending";
          if (index === current) targetStep.setAttribute("aria-current", "step");
          else targetStep.removeAttribute("aria-current");
        });
      afterUpdate?.();
    },
  );
};
