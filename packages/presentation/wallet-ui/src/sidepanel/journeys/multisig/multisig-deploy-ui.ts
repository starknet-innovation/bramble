/**
 * Multisig declaration and staged deployment bindings. This stays isolated
 * because Bun 1.3.x's bundler scope visitor crashes when this closure shares
 * multisig-ui.ts with the proposal state machine.
 */
import { escapeHtml } from "@mc-wallet/core/html";
import { type FeeEstimate, isFeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import { normalizeFeltInput } from "@mc-wallet/wallet-model/networks";
import { buttonBusy, errorMessage, renderFragment, showToast } from "../../shared/dom";
import { formatFeeEstimate } from "../../shared/review-render";
import type { MultisigClient } from "./multisig-runtime";
import { bindSignerPicker } from "./multisig-signers-field";

type DeployActionRunner = (
  button: HTMLButtonElement | null | undefined,
  resultId: string,
  pendingMessage: string,
  action: () => Promise<string>,
) => void;

type MultisigDeployUiDeps = {
  readonly app: Element | null;
  readonly multisig: MultisigClient;
  readonly openList: () => void;
  readonly rerender: () => Promise<void>;
  readonly runAction: DeployActionRunner;
  readonly setResult: (id: string, message: string) => void;
};

type DeployFormState = {
  readonly deps: MultisigDeployUiDeps;
  readonly review: HTMLElement | null;
  readonly submitButton: HTMLButtonElement | null;
  reviewedFee: FeeEstimate | null;
  reviewedKey: string | null;
};

const DEPLOY_FORM_STATES = new WeakMap<HTMLFormElement, DeployFormState>();
const DECLARE_FEES = new WeakMap<HTMLButtonElement, FeeEstimate>();

const parseFelts = (raw: string): readonly string[] =>
  raw
    .split(/[\s,]+/)
    .map((felt) => normalizeFeltInput(felt))
    .filter((felt) => felt.length > 0);

const resetDeployReview = (event: Event): void => {
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const state = DEPLOY_FORM_STATES.get(form);
  if (!state) return;
  state.reviewedFee = null;
  state.reviewedKey = null;
  if (state.review) renderFragment(state.review, "");
  state.submitButton?.lastChild?.replaceWith("Review deployment");
  buttonBusy(state.submitButton, false);
};

const submitDeployment = (event: SubmitEvent): void => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const state = DEPLOY_FORM_STATES.get(form);
  if (!state) return;
  const data = new FormData(form);
  const quorum = Number(String(data.get("quorum") ?? "").trim());
  const signers = parseFelts(String(data.get("signers") ?? ""));
  const salt = normalizeFeltInput(String(data.get("salt") ?? ""));
  const key = JSON.stringify({ quorum, salt, signers });
  if (state.reviewedKey !== key) {
    buttonBusy(state.submitButton, true);
    state.deps.setResult("multisig-deploy-result", "Estimating network fee…");
    void state.deps.multisig
      .deployMultisig(signers, quorum, salt)
      .then((response) => {
        if (!isFeeEstimate(response)) throw new Error("deployment fee review unavailable");
        state.reviewedFee = response;
        state.reviewedKey = key;
        if (state.review) {
          renderFragment(
            state.review,
            `<section class="review-panel" role="note">
              <p><strong>Deployment rules</strong></p>
              <dl class="request-detail">
                <div><dt>Signers</dt><dd>${signers.length}</dd></div>
                <div><dt>Approvals required</dt><dd>${quorum} of ${signers.length}</dd></div>
                <div><dt>Deployment salt</dt><dd><code>${escapeHtml(salt)}</code></dd></div>
              </dl>
              <p class="review-fee">Maximum network fee: ${escapeHtml(formatFeeEstimate(response))}</p>
              <p class="hint">These inputs deterministically create the shared account.</p>
            </section>`,
          );
        }
        state.submitButton?.lastChild?.replaceWith("Deploy reviewed Multisig");
        state.deps.setResult("multisig-deploy-result", "Review the rules and network fee.");
        buttonBusy(state.submitButton, false);
      })
      .catch((error: unknown) => {
        const failed = errorMessage(error, "Fee estimate failed");
        showToast(failed, "error");
        state.deps.setResult("multisig-deploy-result", failed);
        buttonBusy(state.submitButton, false);
      });
    return;
  }
  const reviewedFee = state.reviewedFee;
  if (!reviewedFee) return;
  state.reviewedFee = null;
  state.reviewedKey = null;
  state.deps.runAction(
    state.submitButton,
    "multisig-deploy-result",
    "Submitting deployment…",
    async () => {
      const result = await state.deps.multisig.deployMultisig(signers, quorum, salt, reviewedFee);
      if (isFeeEstimate(result)) throw new Error("deployment fee review changed");
      state.deps.openList();
      return result.tracked
        ? `Deployment submitted at ${result.address} and added to watched multisigs`
        : `Deployment submitted at ${result.address}, but automatic tracking failed — watch this address manually`;
    },
  );
};

/**
 * Binds class declaration, signer-stage navigation, stable review, and final
 * deployment. Exact signer/quorum/salt values must be reviewed unchanged.
 */
export const bindMultisigDeploy = (deps: MultisigDeployUiDeps): void => {
  // Do not shorten this binding to `declare`: Bun 1.3.3 treats that
  // TypeScript contextual keyword specially and drops the listener in output.
  const declareButton = deps.app?.querySelector<HTMLButtonElement>("#multisig-declare");
  declareButton?.addEventListener("click", () => {
    const reviewedFee = DECLARE_FEES.get(declareButton);
    if (!reviewedFee) {
      buttonBusy(declareButton, true);
      deps.setResult("multisig-declare-result", "Estimating network fee…");
      void deps.multisig
        .declareClass()
        .then((response) => {
          if (!isFeeEstimate(response)) throw new Error("declaration fee review unavailable");
          DECLARE_FEES.set(declareButton, response);
          const fee = formatFeeEstimate(response);
          deps.setResult("multisig-declare-result", `Maximum network fee: ${fee}`);
          declareButton.lastChild?.replaceWith(`Confirm declaration · ${fee}`);
          buttonBusy(declareButton, false);
        })
        .catch((error: unknown) => {
          const failed = errorMessage(error, "Fee estimate failed");
          showToast(failed, "error");
          deps.setResult("multisig-declare-result", failed);
          buttonBusy(declareButton, false);
        });
      return;
    }
    DECLARE_FEES.delete(declareButton);
    deps.runAction(declareButton, "multisig-declare-result", "Submitting declare…", async () => {
      const transactionHash = await deps.multisig.declareClass(reviewedFee);
      if (typeof transactionHash !== "string") throw new Error("declaration fee review changed");
      return `Declare submitted: ${transactionHash}`;
    });
  });
  const retry = deps.app?.querySelector<HTMLButtonElement>("#multisig-class-retry");
  retry?.addEventListener("click", () => {
    buttonBusy(retry, true);
    void deps.rerender().catch(() => buttonBusy(retry, false));
  });

  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-deploy-form");
  const signersField = form?.querySelector<HTMLInputElement>('input[name="signers"]');
  bindSignerPicker(deps.app, signersField);
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const review = deps.app?.querySelector<HTMLElement>("#multisig-deploy-review");
  if (!form) return;
  DEPLOY_FORM_STATES.set(form, {
    deps,
    review: review ?? null,
    reviewedFee: null,
    reviewedKey: null,
    submitButton: submitButton ?? null,
  });
  form.addEventListener("input", resetDeployReview);
  form.addEventListener("submit", submitDeployment);
};
