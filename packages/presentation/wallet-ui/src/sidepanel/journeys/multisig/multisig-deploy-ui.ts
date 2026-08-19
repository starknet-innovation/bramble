/** Two-step exact-review binding for stable Argent multisig deployment. */
import { escapeHtml } from "@mc-wallet/core/html";
import { ARGENT_MULTISIG_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import { button as buttonMarkup } from "@mc-wallet/ui-kit/controls";
import {
  explorerTransactionUrl,
  isNonZeroStarkFieldElement,
  normalizeFeltInput,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import type { ArgentMultisigDeploymentReview } from "../../../popup/responses/multisig-responses";
import { transitionTaskStage } from "../../app/rendering/stage-transition";
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
import type { SendIntent } from "../send/send-model";
import {
  ALREADY_DEPLOYED_MESSAGE,
  deploymentFailureToast,
  deploymentReviewFailure,
  EXPIRED_DEPLOYMENT_REVIEW,
} from "./multisig-deploy-errors";
import { bindDeploymentFunding } from "./multisig-deploy-funding-ui";
import { deploymentFundingStage } from "./multisig-deploy-view";
import type { ArgentMultisigDeploymentSetup, MultisigClient } from "./multisig-runtime";

type MultisigDeployUiDeps = {
  readonly app: Element | null;
  readonly multisig: MultisigClient;
  readonly openDetail: (id: string) => void;
  readonly openFunding: (intent: SendIntent) => Promise<void>;
  readonly setResult: (id: string, message: string) => void;
};

type DeploymentStage = "setup" | "approval" | "address" | "fund" | "deploy" | "confirm";
const DEPLOYMENT_STAGE_ORDER: Readonly<Record<DeploymentStage, number>> = {
  address: 2,
  approval: 1,
  confirm: 5,
  deploy: 4,
  fund: 3,
  setup: 0,
};

const setDeploymentStage = (
  form: HTMLFormElement,
  stage: DeploymentStage,
  afterUpdate?: () => void,
): void => {
  const targetForm = form;
  const previous = (form.dataset["deploymentStage"] as DeploymentStage | undefined) ?? "setup";
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
        });
      afterUpdate?.();
    },
  );
};

const reviews = new WeakMap<
  HTMLFormElement,
  {
    readonly input: ArgentMultisigDeploymentSetup;
    readonly review: ArgentMultisigDeploymentReview;
  }
>();
const reviewGenerations = new WeakMap<HTMLFormElement, number>();
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

const mountLocalFundingControls = (form: HTMLFormElement, reviewRoot: HTMLElement): void => {
  const stage = reviewRoot.querySelector(".multisig-funding-stage");
  const refresh = stage?.querySelector("[data-multisig-check-funding]");
  const localControls = form.querySelector<HTMLTemplateElement>("[data-multisig-funding-controls]");
  if (stage && refresh && localControls) {
    stage.insertBefore(localControls.content.cloneNode(true), refresh);
  }
};

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
  const continueButton = form?.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]");
  const deploymentSignerStatus = form?.querySelector<HTMLElement>(
    "[data-deployment-signer-status]",
  );
  const manualSignerInput = form?.querySelector<HTMLInputElement>(
    "[data-manual-signer-public-key]",
  );
  const manualSignerResult = form?.querySelector<HTMLElement>("[data-manual-signer-result]");
  const manualSignerTemplate = form?.querySelector<HTMLTemplateElement>(
    "[data-manual-signer-template]",
  );
  const nameInput = form?.querySelector<HTMLInputElement>('input[name="name"]');
  const thresholdInput = form?.querySelector<HTMLInputElement>('input[name="threshold"]');
  if (form) setDeploymentStage(form, "setup");
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
    const deploymentChoices = Array.from(
      form?.querySelectorAll<HTMLButtonElement>("[data-deployment-signer]") ?? [],
    );
    const localSignerKeys = deploymentChoices.flatMap((choice) =>
      choice.dataset["deploymentSignerKey"] ? [choice.dataset["deploymentSignerKey"]] : [],
    );
    deploymentChoices.forEach((choice) => {
      const targetChoice = choice;
      const publicKey = targetChoice.dataset["deploymentSignerKey"];
      targetChoice.hidden = !(
        publicKey && selectedKeys.some((candidate) => sameFelt(candidate, publicKey))
      );
    });
    const selectedDeployment = deploymentChoices.find(
      (choice) => choice.dataset["deploymentSigner"] === signerAccountInput?.value,
    );
    if ((!selectedDeployment || selectedDeployment.hidden) && signerAccountInput) {
      const next = deploymentChoices.find((choice) => !choice.hidden);
      signerAccountInput.value = next?.dataset["deploymentSigner"] ?? "";
      deploymentChoices.forEach((choice) => {
        choice.setAttribute("aria-pressed", String(choice === next));
      });
    }
    const selectedLocalCount = selected.filter((row) =>
      localSignerKeys.some((key) => sameFelt(key, row.dataset["signerPublicKey"] ?? "")),
    ).length;
    selected.forEach((row) => {
      const remove = row.querySelector<HTMLButtonElement>("[data-remove-signer-public-key]");
      const isLocal = localSignerKeys.some((key) =>
        sameFelt(key, row.dataset["signerPublicKey"] ?? ""),
      );
      if (remove) remove.disabled = selected.length === 1 || (isLocal && selectedLocalCount === 1);
    });
    const hasDeploymentSigner = deploymentChoices.some((choice) => !choice.hidden);
    if (continueButton) continueButton.disabled = !hasDeploymentSigner;
    if (button) button.disabled = form?.dataset["classReady"] !== "true" || !hasDeploymentSigner;
    if (deploymentSignerStatus) {
      deploymentSignerStatus.textContent = hasDeploymentSigner
        ? ""
        : "Add an account from this wallet to the signer set before continuing.";
    }
    if (thresholdInput && Number(thresholdInput.value) > selected.length) {
      thresholdInput.value = String(selected.length);
    }
    if (thresholdInput) thresholdInput.max = String(selected.length);
    notifyInput(signerKeyInput);
  };
  form?.querySelectorAll<HTMLButtonElement>("[data-deployment-signer]").forEach((choice) => {
    choice.addEventListener("click", () => {
      const accountId = choice.dataset["deploymentSigner"];
      if (
        choice.hidden ||
        !accountId ||
        !signerAccountInput ||
        signerAccountInput.value === accountId
      )
        return;
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
  form
    ?.querySelector<HTMLButtonElement>("[data-multisig-deploy-continue]")
    ?.addEventListener("click", () => {
      setDeploymentStage(form, "approval", () => thresholdInput?.focus({ preventScroll: true }));
    });
  form
    ?.querySelector<HTMLButtonElement>("[data-multisig-deploy-back]")
    ?.addEventListener("click", () => {
      setDeploymentStage(form, "setup", () => nameInput?.focus({ preventScroll: true }));
    });
  form?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!["name", "salt", "signerAccountId", "signerPublicKeys", "threshold"].includes(target.name))
      return;
    reviews.delete(form);
    reviewGenerations.set(form, (reviewGenerations.get(form) ?? 0) + 1);
    if (reviewRoot) renderFragment(reviewRoot, "");
    if (button) button.hidden = false;
    setDeploymentStage(
      form,
      target.closest(".multisig-deploy-signers-step") ? "setup" : "approval",
    );
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
      setDeploymentStage(form, "confirm");
      deps.setResult("multisig-deploy-result", "Submitting exact reviewed deployment…");
      reviews.delete(form);
      void deps.multisig.deployMultisig(reviewed).then(
        async (result) => {
          const explorer = explorerTransactionUrl(reviewed.networkId, result.transactionHash);
          if (reviewRoot) {
            renderFragment(
              reviewRoot,
              `<section class="multisig-deployment-success" role="status" aria-live="polite">
                <span class="multisig-deployment-success-mark">${icon("check")}</span>
                <div><p class="context-label">Submitted to Starknet</p><h2>Multisig deployment is in progress</h2></div>
                <p>The account is saved and the transaction hash will remain available while the network confirms deployment.</p>
                <dl class="request-detail">
                  <div><dt>Address</dt><dd><code>${escapeHtml(accountLabel(result.address))}</code>${copyButton(result.address, "Copy multisig address")}</dd></div>
                  <div><dt>Transaction</dt><dd><code>${escapeHtml(accountLabel(result.transactionHash))}</code>${copyButton(result.transactionHash, "Copy deployment transaction hash")}</dd></div>
                </dl>
                <div class="multisig-deployment-success-actions">
                  ${buttonMarkup({ attributes: { "data-open-deployed-multisig": result.multisig.record.id }, label: "Go to deployed account" })}
                  ${explorer ? `<a class="button secondary" href="${escapeHtml(explorer)}" target="_blank" rel="noopener noreferrer">View transaction</a>` : ""}
                </div>
              </section>`,
            );
            bindCopyButtons(reviewRoot);
            reviewRoot
              .querySelector<HTMLButtonElement>("[data-open-deployed-multisig]")
              ?.addEventListener("click", () => deps.openDetail(result.multisig.record.id));
          }
          if (button) button.hidden = true;
          deps.setResult("multisig-deploy-result", "");
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
          setDeploymentStage(form, "deploy");
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
    setDeploymentStage(form, "address");
    void deps.multisig
      .reviewDeployment(input)
      .then((next) => {
        if (!isCurrent()) return;
        const fundingRequired = next.feeAffordability === "insufficient";
        if (!fundingRequired) reviews.set(form, { input, review: next });
        if (reviewRoot) {
          renderFragment(
            reviewRoot,
            fundingRequired
              ? deploymentFundingStage(next)
              : `${reviewOutcome(`Deploy a ${next.threshold}-of-${next.signerPublicKeys.length} Argent multisig.`)}
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
                  <div><dt>Contract</dt><dd>Argent Multisig ${ARGENT_MULTISIG_CONTRACT.version}</dd></div>
                  <div><dt>Class hash</dt><dd><code>${escapeHtml(ARGENT_MULTISIG_CONTRACT.classHash)}</code>${copyButton(ARGENT_MULTISIG_CONTRACT.classHash, "Copy Argent Multisig class hash")}</dd></div>
                  <div><dt>Network</dt><dd><code>${escapeHtml(next.networkId)}</code></dd></div>
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
          if (fundingRequired) {
            mountLocalFundingControls(form, reviewRoot);
            bindDeploymentFunding(deps, form, next);
          }
        }
        setDeploymentStage(form, fundingRequired ? "fund" : "deploy");
        if (button) button.hidden = fundingRequired;
        button?.lastChild?.replaceWith(
          fundingRequired ? "Review deployment" : "Deploy reviewed account",
        );
        deps.setResult("multisig-deploy-result", "");
        buttonBusy(button, false);
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        const message = deploymentReviewFailure(errorMessage(error, "Deployment review failed"));
        setDeploymentStage(form, "approval");
        deps.setResult(
          "multisig-deploy-result",
          message === ALREADY_DEPLOYED_MESSAGE
            ? message
            : "Deployment review failed. Check the error and retry.",
        );
        showToast(message, "error", form);
        buttonBusy(button, false);
      });
  });
};
