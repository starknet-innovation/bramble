/** Local and external funding controls for a predicted Argent multisig address. */
import type { ArgentMultisigDeploymentReview } from "../../../popup/responses/multisig-responses";
import { bindCopyButtons, errorMessage, showToast } from "../../shared/dom";
import type { SendIntent } from "../send/send-model";

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
      void deps
        .openFunding({
          accountId: source,
          completeMultisigId: `${review.networkId}:${review.address}`,
          completeTo: "multisig-home",
          destination: "public",
          networkId: review.networkId,
          recipient: review.address,
          recipientLabel: review.name ?? "New Argent multisig",
          source: "public",
          tokenId,
        })
        .catch((error: unknown) =>
          showToast(errorMessage(error, "Open funding transfer failed"), "error", form),
        );
    });
  form
    .querySelector<HTMLButtonElement>("[data-multisig-check-funding]")
    ?.addEventListener("click", () => form.requestSubmit());
};
