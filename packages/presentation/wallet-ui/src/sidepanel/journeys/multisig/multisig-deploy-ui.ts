/** Two-step exact-review binding for stable Argent multisig deployment. */
import { escapeHtml } from "@mc-wallet/core/html";
import {
  isNonZeroStarkFieldElement,
  normalizeFeltInput,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import type { ArgentMultisigDeploymentReview } from "../../../popup/responses/multisig-responses";
import {
  bindCopyButtons,
  buttonBusy,
  errorMessage,
  renderFragment,
  showToast,
} from "../../shared/dom";
import { icon } from "../../shared/icons";
import { accountLabel, copyButton } from "../../shared/parts";
import {
  formatFeeEstimate,
  reviewConstraints,
  reviewOutcome,
  reviewPanel,
} from "../../shared/review-render";
import type { ArgentMultisigDeploymentSetup, MultisigClient } from "./multisig-runtime";

type MultisigDeployUiDeps = {
  readonly app: Element | null;
  readonly multisig: MultisigClient;
  readonly openList: () => void;
  readonly rerender: () => Promise<void>;
  readonly setResult: (id: string, message: string) => void;
};

const reviews = new WeakMap<
  HTMLFormElement,
  {
    readonly input: ArgentMultisigDeploymentSetup;
    readonly review: ArgentMultisigDeploymentReview;
  }
>();
const reviewGenerations = new WeakMap<HTMLFormElement, number>();
const EXPIRED_DEPLOYMENT_REVIEW =
  "Argent multisig deployment must exactly match a fresh fee review";

const deploymentFailureToast = (raw: string, review: ArgentMultisigDeploymentReview): string => {
  if (raw === EXPIRED_DEPLOYMENT_REVIEW) {
    return "The fee review expired. Review the deployment again before confirming.";
  }
  if (/exceed balance|insufficient.*balance|address needs STRK/i.test(raw)) {
    return `Fund ${accountLabel(review.address)} with at least ${formatFeeEstimate(review.fee)}, then review the deployment again.`;
  }
  return raw;
};

const publicKeys = (raw: string): readonly string[] =>
  raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(normalizeFeltInput);

const deploymentSetup = (form: HTMLFormElement): ArgentMultisigDeploymentSetup => {
  const data = new FormData(form);
  return {
    ...(String(data.get("expectedAddress") ?? "")
      ? { expectedAddress: normalizeFeltInput(String(data.get("expectedAddress"))) }
      : {}),
    ...(String(data.get("name") ?? "").trim()
      ? { name: String(data.get("name") ?? "").trim() }
      : {}),
    networkId: String(data.get("signerAccountId") ?? "").split(":")[0] ?? "",
    salt: normalizeFeltInput(String(data.get("salt") ?? "")),
    signerAccountId: String(data.get("signerAccountId") ?? ""),
    signerPublicKeys: publicKeys(String(data.get("signerPublicKeys") ?? "")),
    threshold: Number(data.get("threshold")),
  };
};

const sameSetup = (
  left: ArgentMultisigDeploymentSetup,
  right: ArgentMultisigDeploymentSetup,
): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Binds review then exact echoed deployment; editing invalidates consent.
 */
export const bindMultisigDeploy = (deps: MultisigDeployUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-deploy-form");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const reviewEnabled = button?.disabled === false;
  const reviewRoot = deps.app?.querySelector<HTMLElement>("#multisig-deploy-review");
  const signerAccountInput = form?.querySelector<HTMLInputElement>('input[name="signerAccountId"]');
  const signerKeyInput = form?.querySelector<HTMLInputElement>('input[name="signerPublicKeys"]');
  const signerList = form?.querySelector<HTMLElement>("[data-selected-signers]");
  const signerCount = form?.querySelector<HTMLElement>("[data-signer-count]");
  const signerDisclosure = form?.querySelector<HTMLElement>(".multisig-signer-sources > summary");
  const manualSignerInput = form?.querySelector<HTMLInputElement>(
    "[data-manual-signer-public-key]",
  );
  const manualSignerResult = form?.querySelector<HTMLElement>("[data-manual-signer-result]");
  const manualSignerTemplate = form?.querySelector<HTMLTemplateElement>(
    "[data-manual-signer-template]",
  );
  const thresholdInput = form?.querySelector<HTMLInputElement>('input[name="threshold"]');
  const notifyInput = (input: HTMLInputElement): void => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const signerRows = (): readonly HTMLElement[] =>
    signerList ? [...signerList.querySelectorAll<HTMLElement>("[data-signer-public-key]")] : [];
  const rowForKey = (publicKey: string): HTMLElement | undefined =>
    signerRows().find((row) => sameFelt(row.dataset["signerPublicKey"] ?? "", publicKey));
  const syncSignerSet = (): void => {
    if (!signerKeyInput) return;
    const selected = signerRows().filter((row) => !row.hidden);
    const selectedKeys = selected.flatMap((row) =>
      row.dataset["signerPublicKey"] ? [row.dataset["signerPublicKey"]] : [],
    );
    signerKeyInput.value = selectedKeys.join(" ");
    if (signerCount) {
      signerCount.textContent = `${selected.length} signer${selected.length === 1 ? "" : "s"}`;
    }
    form?.querySelectorAll<HTMLButtonElement>("[data-add-signer-public-key]").forEach((choice) => {
      const sourceChoice = choice;
      const publicKey = choice.dataset["addSignerPublicKey"];
      sourceChoice.hidden = Boolean(
        publicKey && selectedKeys.some((candidate) => sameFelt(candidate, publicKey)),
      );
    });
    selected.forEach((row) => {
      const remove = row.querySelector<HTMLButtonElement>("[data-remove-signer-public-key]");
      if (remove) remove.disabled = selected.length === 1;
    });
    if (thresholdInput && Number(thresholdInput.value) > selected.length) {
      thresholdInput.value = String(selected.length);
    }
    notifyInput(signerKeyInput);
  };
  form?.querySelectorAll<HTMLButtonElement>("[data-deployment-signer]").forEach((choice) => {
    choice.addEventListener("click", () => {
      const accountId = choice.dataset["deploymentSigner"];
      if (!accountId || !signerAccountInput || signerAccountInput.value === accountId) return;
      signerAccountInput.value = accountId;
      form.querySelectorAll<HTMLButtonElement>("[data-deployment-signer]").forEach((candidate) => {
        candidate.setAttribute(
          "aria-pressed",
          String(candidate.dataset["deploymentSigner"] === accountId),
        );
      });
      notifyInput(signerAccountInput);
    });
  });
  form?.querySelectorAll<HTMLButtonElement>("[data-add-signer-public-key]").forEach((choice) => {
    choice.addEventListener("click", () => {
      const publicKey = choice.dataset["addSignerPublicKey"];
      const row = publicKey ? rowForKey(publicKey) : undefined;
      if (!row?.hidden) return;
      row.hidden = false;
      syncSignerSet();
      signerDisclosure?.focus();
    });
  });
  signerList?.addEventListener("click", (event) => {
    const target = event.target;
    const ElementType = signerList.ownerDocument.defaultView?.Element;
    if (!ElementType || !(target instanceof ElementType)) return;
    const remove = target.closest<HTMLButtonElement>("[data-remove-signer-public-key]");
    const row = remove?.closest<HTMLElement>("[data-signer-public-key]");
    if (!remove || !row || remove.disabled) return;
    if (row.hasAttribute("data-manual-signer")) row.remove();
    else row.hidden = true;
    syncSignerSet();
    signerDisclosure?.focus();
  });
  const addManualSigner = (): void => {
    if (!manualSignerInput || !manualSignerTemplate || !signerList) return;
    const publicKey = normalizeFeltInput(manualSignerInput.value);
    if (!isNonZeroStarkFieldElement(publicKey)) {
      if (manualSignerResult) {
        manualSignerResult.textContent = "Enter a valid non-zero Starknet public key.";
      }
      manualSignerInput.focus();
      return;
    }
    const knownRow = rowForKey(publicKey);
    if (knownRow && !knownRow.hidden) {
      if (manualSignerResult) manualSignerResult.textContent = "That signer is already included.";
      manualSignerInput.focus();
      return;
    }
    if (knownRow) {
      knownRow.hidden = false;
    } else {
      const fragment = manualSignerTemplate.content.cloneNode(true) as DocumentFragment;
      const row = fragment.querySelector<HTMLElement>(".multisig-selected-signer");
      const label = fragment.querySelector<HTMLElement>("[data-manual-signer-label]");
      const remove = fragment.querySelector<HTMLButtonElement>("[data-remove-signer-public-key]");
      if (!row || !label || !remove) return;
      row.dataset["signerPublicKey"] = publicKey;
      label.textContent = `Key ${accountLabel(publicKey)}`;
      remove.dataset["removeSignerPublicKey"] = publicKey;
      signerList.append(fragment);
    }
    manualSignerInput.value = "";
    if (manualSignerResult) manualSignerResult.textContent = "Signer added.";
    syncSignerSet();
    manualSignerInput.focus();
  };
  form
    ?.querySelector<HTMLButtonElement>("[data-add-manual-signer]")
    ?.addEventListener("click", addManualSigner);
  manualSignerInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addManualSigner();
  });
  form?.addEventListener("input", (event) => {
    if (event.target === manualSignerInput) return;
    reviews.delete(form);
    reviewGenerations.set(form, (reviewGenerations.get(form) ?? 0) + 1);
    if (reviewRoot) renderFragment(reviewRoot, "");
    button?.lastChild?.replaceWith("Review deployment");
    if (reviewEnabled) buttonBusy(button, false);
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    let input: ArgentMultisigDeploymentSetup;
    try {
      input = deploymentSetup(form);
    } catch (error) {
      const message = errorMessage(error, "Invalid deployment fields");
      deps.setResult("multisig-deploy-result", "Check the deployment fields and try again.");
      showToast(message, "error", form);
      return;
    }
    const stored = reviews.get(form);
    const reviewed = stored && sameSetup(stored.input, input) ? stored.review : undefined;
    if (stored && !reviewed) {
      reviews.delete(form);
      if (reviewRoot) renderFragment(reviewRoot, "");
      button?.lastChild?.replaceWith("Review deployment");
    }
    buttonBusy(button, true);
    if (reviewed) {
      deps.setResult("multisig-deploy-result", "Submitting exact reviewed deployment…");
      reviews.delete(form);
      void deps.multisig.deployMultisig(reviewed).then(
        async (result) => {
          showToast(`Deployment submitted: ${result.transactionHash}`, "success", form);
          deps.openList();
          await deps.rerender();
        },
        (error: unknown) => {
          const message = errorMessage(error, "Deployment failed");
          deps.setResult(
            "multisig-deploy-result",
            message === EXPIRED_DEPLOYMENT_REVIEW
              ? "Fee review expired. Review the deployment again."
              : "Deployment failed. Review the error, then try again.",
          );
          button?.lastChild?.replaceWith("Review deployment");
          showToast(deploymentFailureToast(message, reviewed), "error", form);
          buttonBusy(button, false);
        },
      );
      return;
    }
    const generation = (reviewGenerations.get(form) ?? 0) + 1;
    reviewGenerations.set(form, generation);
    const isCurrent = (): boolean => {
      if (reviewGenerations.get(form) !== generation) return false;
      try {
        return sameSetup(deploymentSetup(form), input);
      } catch {
        return false;
      }
    };
    deps.setResult("multisig-deploy-result", "Preparing exact deployment fee…");
    void deps.multisig
      .reviewDeployment(input)
      .then((next) => {
        if (!isCurrent()) return;
        const fundingRequired = next.feeAffordability === "insufficient";
        if (!fundingRequired) reviews.set(form, { input, review: next });
        if (reviewRoot) {
          renderFragment(
            reviewRoot,
            `${reviewOutcome(`Deploy a ${next.threshold}-of-${next.signerPublicKeys.length} Argent multisig.`)}
            <div class="multisig-deployment-target" aria-label="Predicted multisig address">
              <span>Predicted address</span>
              <code title="${escapeHtml(next.address)}">${escapeHtml(accountLabel(next.address))}</code>
              ${copyButton(next.address, "Copy predicted multisig address")}
            </div>
            ${reviewPanel([], fundingRequired ? `Funding is required first. Send at least ${formatFeeEstimate(next.fee)} to the predicted address, then check again.` : "Deployment creates a new on-chain shared account. Its address, signer set, threshold, and salt cannot be edited after this submission.")}
            ${reviewConstraints(`Maximum network fee: ${formatFeeEstimate(next.fee)}`)}
            <details class="disclosure" data-disclosure="multisig-deployment-technical">
              <summary>
                <span class="menu-copy"><strong>Technical details</strong><small>Exact constructor authority and signer</small></span>
                <span class="disclosure-mark">${icon("chevronRight")}</span>
              </summary>
              <div class="disclosure-body">
                <dl class="request-detail">
                  <div><dt>Address</dt><dd><code>${escapeHtml(next.address)}</code></dd></div>
                  <div><dt>Signers</dt><dd>${next.signerPublicKeys.length}</dd></div>
                  <div><dt>Public keys</dt><dd><code>${escapeHtml(next.signerPublicKeys.join(" "))}</code></dd></div>
                  <div><dt>Threshold</dt><dd>${next.threshold}</dd></div>
                  <div><dt>Salt</dt><dd><code>${escapeHtml(next.salt)}</code></dd></div>
                  <div><dt>Deployment signer</dt><dd><code>${escapeHtml(next.signerAccountId)}</code></dd></div>
                </dl>
              </div>
            </details>`,
          );
          bindCopyButtons(reviewRoot);
        }
        button?.lastChild?.replaceWith(
          fundingRequired ? "Check funding again" : "Deploy reviewed account",
        );
        deps.setResult(
          "multisig-deploy-result",
          fundingRequired
            ? "Fund the predicted address, then check again."
            : "Review every field, then confirm.",
        );
        buttonBusy(button, false);
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        const message = errorMessage(error, "Deployment review failed");
        deps.setResult(
          "multisig-deploy-result",
          "Deployment review failed. Check the error and retry.",
        );
        showToast(message, "error", form);
        buttonBusy(button, false);
      });
  });
};
