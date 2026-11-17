/** Local and external funding controls for a predicted Argent multisig address. */
import type { ArgentMultisigDeploymentReview } from "../../../popup/responses/multisig-responses";
import { bindCopyButtons, errorDetails, showToast } from "../../shared/dom";
import type { SendIntent } from "../send/send-model";
import { deploymentFundingMinimum } from "./multisig-deploy-view";

type FundingDeps = {
  readonly openFunding: (intent: SendIntent) => Promise<void>;
};

/**
 * Binds local-send and refresh actions. Untrusted runtime failures remain
 * visible in copyable toasts and never advance the deployment stage.
 */
export const bindDeploymentFunding = (
  deps: FundingDeps,
  form: HTMLFormElement,
  review: ArgentMultisigDeploymentReview,
): void => {
  bindCopyButtons(form);
  form
    .querySelector<HTMLButtonElement>("[data-multisig-fund-local]")
    ?.addEventListener("click", () => {
      const source = form.querySelector<HTMLSelectElement>(
        'select[name="fundingAccountId"]',
      )?.value;
      const tokenId = form.querySelector<HTMLInputElement>('input[name="fundingTokenId"]')?.value;
      if (!source || !tokenId) {
        showToast("A local STRK funding account is unavailable", "error", form);
        return;
      }
      // Prefills the STRK minimum the Fund step names, in exact FRI; Send
      // still lets the user change it and asks them to review and confirm.
      const minimum = deploymentFundingMinimum(review);
      void deps
        .openFunding({
          accountId: source,
          ...(minimum === null ? {} : { amount: minimum.toString() }),
          completeMultisigId: `${review.networkId}:${review.address}`,
          completeTo: "multisig-deploy",
          destination: "public",
          networkId: review.networkId,
          recipient: review.address,
          recipientLabel: review.name ?? "New multisig",
          source: "public",
          tokenId,
        })
        .catch((error: unknown) =>
          showToast(errorDetails(error, "Open funding transfer failed"), "error", form),
        );
    });
  form
    .querySelector<HTMLButtonElement>("[data-multisig-check-funding]")
    ?.addEventListener("click", () => form.requestSubmit());
};
