/**
 * Multisig declaration and staged deployment bindings. This stays isolated
 * because Bun 1.3.x's bundler scope visitor crashes when this closure shares
 * multisig-ui.ts with the proposal state machine.
 */
import { escapeHtml } from "../shared/html";
import { normalizeFeltInput } from "../starknet/networks";
import { buttonBusy, renderFragment } from "./dom";
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
  reviewedKey: string | null;
};

const DEPLOY_FORM_STATES = new WeakMap<HTMLFormElement, DeployFormState>();

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
          <p class="hint">These inputs deterministically create the shared account.</p>
        </section>`,
      );
    }
    state.submitButton?.lastChild?.replaceWith("Deploy reviewed Multisig");
    state.deps.setResult("multisig-deploy-result", "Review the signer set and approval rules.");
    return;
  }
  state.deps.runAction(
    state.submitButton,
    "multisig-deploy-result",
    "Submitting deployment…",
    async () => {
      const result = await state.deps.multisig.deployMultisig(signers, quorum, salt);
      state.deps.openList();
      return `Deployment submitted at ${result.address} — watch it once the transaction finalizes`;
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
    deps.runAction(declareButton, "multisig-declare-result", "Submitting declare…", async () => {
      const transactionHash = await deps.multisig.declareClass();
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
    reviewedKey: null,
    submitButton: submitButton ?? null,
  });
  form.addEventListener("input", resetDeployReview);
  form.addEventListener("submit", submitDeployment);
};
