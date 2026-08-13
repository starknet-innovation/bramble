/** Two-step exact-review binding for stable Argent multisig deployment. */
import { escapeHtml } from "@mc-wallet/core/html";
import { normalizeFeltInput } from "@mc-wallet/wallet-model/networks";
import type { ArgentMultisigDeploymentReview } from "../../../popup/responses/multisig-responses";
import { buttonBusy, errorMessage, renderFragment, showToast } from "../../shared/dom";
import { formatFeeEstimate } from "../../shared/review-render";
import type { MultisigClient } from "./multisig-runtime";

type MultisigDeployUiDeps = {
  readonly app: Element | null;
  readonly multisig: MultisigClient;
  readonly openList: () => void;
  readonly rerender: () => Promise<void>;
  readonly setResult: (id: string, message: string) => void;
};

const reviews = new WeakMap<HTMLFormElement, ArgentMultisigDeploymentReview>();

const publicKeys = (raw: string): readonly string[] =>
  raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(normalizeFeltInput);

/**
 * Binds review then exact echoed deployment; editing invalidates consent.
 */
export const bindMultisigDeploy = (deps: MultisigDeployUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-deploy-form");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const reviewPanel = deps.app?.querySelector<HTMLElement>("#multisig-deploy-review");
  form?.addEventListener("input", () => {
    reviews.delete(form);
    if (reviewPanel) renderFragment(reviewPanel, "");
    button?.lastChild?.replaceWith("Review deployment");
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const reviewed = reviews.get(form);
    buttonBusy(button, true);
    if (reviewed) {
      deps.setResult("multisig-deploy-result", "Submitting exact reviewed deployment…");
      reviews.delete(form);
      void deps.multisig.deployMultisig(reviewed).then(
        async (result) => {
          showToast(`Deployment submitted: ${result.transactionHash}`, "success");
          deps.openList();
          await deps.rerender();
        },
        (error: unknown) => {
          const message = errorMessage(error, "Deployment failed");
          deps.setResult("multisig-deploy-result", message);
          showToast(message, "error");
          buttonBusy(button, false);
        },
      );
      return;
    }
    const data = new FormData(form);
    deps.setResult("multisig-deploy-result", "Preparing exact deployment fee…");
    void deps.multisig
      .reviewDeployment({
        ...(String(data.get("name") ?? "").trim()
          ? { name: String(data.get("name") ?? "").trim() }
          : {}),
        networkId: String(data.get("signerAccountId") ?? "").split(":")[0] ?? "",
        salt: normalizeFeltInput(String(data.get("salt") ?? "")),
        signerAccountId: String(data.get("signerAccountId") ?? ""),
        signerPublicKeys: publicKeys(String(data.get("signerPublicKeys") ?? "")),
        threshold: Number(data.get("threshold")),
      })
      .then((next) => {
        reviews.set(form, next);
        if (reviewPanel) {
          renderFragment(
            reviewPanel,
            `<section class="review-panel" role="note">
              <p><strong>Exact deployment review</strong></p>
              <dl class="request-detail">
                <div><dt>Address</dt><dd><code>${escapeHtml(next.address)}</code></dd></div>
                <div><dt>Signers</dt><dd>${next.signerPublicKeys.length}</dd></div>
                <div><dt>Public keys</dt><dd><code>${escapeHtml(next.signerPublicKeys.join(" "))}</code></dd></div>
                <div><dt>Threshold</dt><dd>${next.threshold}</dd></div>
                <div><dt>Salt</dt><dd><code>${escapeHtml(next.salt)}</code></dd></div>
                <div><dt>Deployment signer</dt><dd><code>${escapeHtml(next.signerAccountId)}</code></dd></div>
                <div><dt>Maximum network fee</dt><dd>${escapeHtml(formatFeeEstimate(next.fee))}</dd></div>
              </dl>
            </section>`,
          );
        }
        button?.lastChild?.replaceWith("Deploy reviewed account");
        deps.setResult("multisig-deploy-result", "Review every field, then confirm.");
        buttonBusy(button, false);
      })
      .catch((error: unknown) => {
        const message = errorMessage(error, "Deployment review failed");
        deps.setResult("multisig-deploy-result", message);
        showToast(message, "error");
        buttonBusy(button, false);
      });
  });
};
