/**
 * Pure templates for the STRK20 activation checkpoints.
 *
 * Activation is all this surface renders. Shielding, unshielding, and private
 * sends are composed in the Send flow as a send between two balances, so no
 * amount, direction, or destination is chosen here.
 */

import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState, receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import {
  PRIVACY_OTHER_WALLET,
  PRIVACY_OTHER_WALLET_NEXT,
} from "@bramble/wallet-protocol/privacy-blocker";
import { t, th } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { networkDisplayName } from "../../shared/network-label";
import { flowHeader, flowScreen, formatFri, inlineCopyButton } from "../../shared/parts";
import { liquidDots, liquidDotsFilter } from "../../shared/progress-motion";
import { formatFeeEstimate, reviewPanel } from "../../shared/review-render";
import type {
  PrivacyBlockerKind,
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "./privacy-model";
import { type PreparationProgress, preparationProgressText } from "./privacy-preparation-job";

/**
 * The one line every proving wait shows. Activation proves here; a shield
 * proves at review and a relayed send at confirm, both inside the Send flow,
 * which imports this rather than spelling the guidance a second way.
 */
export const provingHint = (): string => t("privacy.provingHint");

/**
 * The liveness line of a wait: the job's phase and elapsed time when it has
 * reported one, ahead of the standing hint. The phase is a fixed label from the
 * closed vocabulary and the time a number, so this is text, never markup. Both
 * the template and the in-place update on every poll read it from here.
 */
export const privacyLivenessText = (
  progress: PreparationProgress | null | undefined,
  hint: string = provingHint(),
): string =>
  progress ? t("privacy.liveness", { hint, progress: preparationProgressText(progress) }) : hint;

type PreparingStep = Extract<PrivacyJourneyState, { readonly stage: "preparing" }>["step"];

// The wait before the review. Discovery and the activation proof are the two
// legs a click on "Go private" may have to sit through, and the second can take
// minutes: the screen shows how far it has got, how long to expect, and the way
// back, because a bare busy button was exactly what read as a dead click.
//
// The task list below already names the step in progress, so `body` says only
// what the list cannot and is empty when there is nothing to add. Backing out
// is safe — the background finishes the proof it started and never executes an
// abandoned preparation — but the proof is discarded, which is worth a line
// before someone spends minutes on it twice. The proof wait also says nothing
// is signed yet: minutes of "preparing" otherwise read as signing underway.
const preparingCopy = (
  step: PreparingStep,
): { readonly body: string; readonly hint: string; readonly title: string } =>
  step === "discovering"
    ? {
        body: "",
        hint: t("privacy.preparing.discovering.hint"),
        title: t("privacy.preparing.discovering.title"),
      }
    : {
        body: t("privacy.preparing.proving.body"),
        hint: provingHint(),
        title: t("privacy.preparing.proving.title"),
      };

const backToWallet = (): string =>
  button({
    attributes: { id: "privacy-cancel" },
    label: t("privacy.action.backToWallet"),
    variant: "secondary",
  });

const preparing = (
  journey: Extract<PrivacyJourneyState, { readonly stage: "preparing" }>,
): string => {
  const copy = preparingCopy(journey.step);
  const proving = journey.step === "proving";
  return `
  <section class="privacy-working" role="status" aria-live="polite" data-privacy-preparing="${journey.step}">
    ${liquidDots("privacy")}${liquidDotsFilter("privacy")}
    <h2>${escapeHtml(copy.title)}</h2>
    ${copy.body === "" ? "" : `<p>${escapeHtml(copy.body)}</p>`}
    <ol class="privacy-task-list">
      <li data-state="${proving ? "done" : "active"}"><span></span>${th("privacy.task.checkRegistration")}</li>
      <li data-state="${proving ? "active" : "pending"}"><span></span>${th("privacy.task.buildProof")}</li>
      <li data-state="pending"><span></span>${th("privacy.task.reviewAndConfirm")}</li>
      <li data-state="pending"><span></span>${th("privacy.task.broadcast")}</li>
    </ol>
    <p class="hint" id="privacy-liveness">${escapeHtml(privacyLivenessText(journey.progress, copy.hint))}</p>
    <div class="privacy-actions">
      ${backToWallet()}
    </div>
  </section>`;
};

const shortAddress = (value: string): string =>
  value.length <= 15 ? value : `${value.slice(0, 8)}…${value.slice(-5)}`;

// Owner-approved consent copy (issue 438). The fee sentence rides on the same
// condition as the Cost section's "Pool fee … from public STRK" line, so the
// two never disagree; the amount itself stays only in Cost. Registration from
// the background always takes the public-account route with a pool fee.
const activationOutcome = (
  preparation: Extract<PrivacyJourneyState, { readonly stage: "activate-review" }>["preparation"],
): string =>
  t(preparation.poolFeeFri ? "review.privacy.outcomeWithPoolFee" : "review.privacy.outcome");

const preparationDetails = (
  journey: Extract<PrivacyJourneyState, { readonly stage: "activate-review" }>,
  status: WalletStatus,
): string => {
  const { preparation } = journey;
  return `<section class="privacy-review">
    <header class="decision-head">
      <span class="decision-seal">${icon("shield")}</span>
      <span><p class="decision-label">${th("review.privacy.reviewedIntent")}</p><h2>${th("review.privacy.activate")}</h2></span>
    </header>
    <section class="decision-layer decision-outcome" aria-label="${th("review.privacy.whatWillHappen")}">
      <p class="decision-label">${th("review.privacy.whatWillHappen")}</p>
      <p>${escapeHtml(activationOutcome(preparation))}</p>
    </section>
    ${reviewPanel([t("review.privacy.registrationPublic")])}
    <section class="decision-layer decision-boundary" aria-label="${th("review.privacy.cost")}">
      <p class="decision-label">${th("review.privacy.cost")}</p>
      ${receipt([
        {
          label: t("review.privacy.maxFee"),
          value: preparation.networkFee
            ? formatFeeEstimate(preparation.networkFee)
            : t(
                preparation.route === "private-relay"
                  ? "review.privacy.sponsored"
                  : "review.privacy.unavailable",
              ),
        },
        ...(preparation.poolFeeFri
          ? [
              {
                label: t("review.privacy.poolFee"),
                value: t("review.privacy.poolFeeValue", {
                  amount: formatFri(preparation.poolFeeFri),
                }),
              },
            ]
          : []),
        {
          label: t("review.privacy.submission"),
          value: t(
            preparation.route === "private-relay"
              ? "review.privacy.privateRelay"
              : "review.privacy.publicAccountTransaction",
          ),
        },
      ])}
    </section>
    <details class="send-review-disclosure" data-disclosure="privacy-activation-technical">
      <summary><span>${th("review.privacy.technical")}</span>${icon("chevronDown")}</summary>
      <div class="send-review-disclosure-body">
    ${receipt([
      { label: t("review.privacy.network"), value: networkDisplayName(status.network) },
      ...(preparation.authorization
        ? [
            {
              label: t("review.privacy.publicApprovalCalls"),
              value: String(preparation.authorization.publicCallCount),
            },
            {
              label: t("review.privacy.authorizationWindow"),
              value: `${shortAddress(preparation.authorization.executeAfter)} → ${shortAddress(preparation.authorization.executeBefore)}`,
              valueStyle: "code" as const,
            },
            {
              action: {
                attributes: { "data-copy": preparation.authorization.caller },
                icon: "copy" as const,
                label: t("review.privacy.copyCaller"),
              },
              label: t("review.privacy.authorizationCaller"),
              value: shortAddress(preparation.authorization.caller),
              valueStyle: "code" as const,
            },
          ]
        : []),
      {
        action: {
          attributes: { "data-copy": preparation.poolAddress },
          icon: "copy",
          label: t("review.privacy.copyPool"),
        },
        label: t("review.privacy.pool"),
        value: shortAddress(preparation.poolAddress),
        valueStyle: "code",
      },
    ])}
    <ul class="privacy-facts">
      ${preparation.summaries.map((summary) => `<li>${escapeHtml(summary)}</li>`).join("")}
    </ul>
      </div>
    </details>
    <p id="privacy-review-result" role="status" aria-live="assertive"></p>
    ${button({
      attributes: { id: "privacy-confirm" },
      icon: "shield",
      label: t("review.privacy.activate"),
    })}
  </section>`;
};

const working = (journey: Extract<PrivacyJourneyState, { readonly stage: "working" }>): string => `
  <section class="privacy-working" role="status" aria-live="polite">
    ${liquidDots("privacy")}${liquidDotsFilter("privacy")}
    <h2>${th("privacy.working.title")}</h2>
    <p>${th("privacy.working.body")}</p>
    <ol class="privacy-task-list">
      <li data-state="done"><span></span>${th("privacy.task.reviewComplete")}</li>
      <li data-state="active"><span></span>${th("privacy.task.generateAndAuthorize")}</li>
      <li data-state="pending"><span></span>${th("privacy.task.broadcast")}</li>
      <li data-state="pending"><span></span>${th("privacy.task.discoverBalance")}</li>
    </ol>
    <p class="hint" id="privacy-liveness">${escapeHtml(privacyLivenessText(journey.progress))}</p>
  </section>`;

const success = (journey: Extract<PrivacyJourneyState, { readonly stage: "success" }>): string => `
  <section class="privacy-outcome privacy-success" role="status" aria-live="polite">
    <span class="privacy-outcome-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg></span>
    <h2>${th("privacy.success.title")}</h2>
    <p>${th("privacy.success.body", { symbol: journey.symbol })}</p>
    <div class="privacy-actions">
      ${button({ attributes: { id: "privacy-done" }, label: t("privacy.action.backToWallet"), variant: "secondary" })}
      ${button({ attributes: { "data-view": "activity" }, icon: "activity", label: t("privacy.action.viewActivity"), variant: "secondary" })}
    </div>
  </section>`;

const failure = (journey: Extract<PrivacyJourneyState, { readonly stage: "failure" }>): string => {
  // A submission whose reply was lost is a warning, not a failure: it may still
  // be on chain, so it leads with Activity rather than the Try again a failure
  // offers (issue 382). The mark switches to the "!" the send receipt uses.
  // Either way the sentence is the friendly one, and the control beside it
  // copies the complete diagnostic for support, as an error toast's does.
  const warning = journey.severity === "warning";
  return `
  <section class="privacy-outcome privacy-failure" role="alert" aria-live="assertive" data-severity="${journey.severity}">
    <span class="privacy-outcome-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><circle class="send-failure-ring" cx="28" cy="28" r="25" /><path class="send-failure-mark" d="m20 20 16 16m0-16L20 36" /><path class="privacy-unknown-mark" d="M28 17v13m0 8v1" /></svg></span>
    <h2>${warning ? th("privacy.failure.statusUnknown") : th("privacy.failure.notCompleted")}</h2>
    <span class="privacy-outcome-reason">
      <p>${escapeHtml(journey.error)}</p>
      ${inlineCopyButton(journey.errorDetails || journey.error, t("privacy.failure.copyDetails"), { id: "privacy-failure-copy-error" })}
    </span>
    ${warning ? "" : `<p class="hint">${th("privacy.failure.noRetry")}</p>`}
    <div class="privacy-actions">
      ${
        warning
          ? button({
              attributes: { "data-view": "activity" },
              icon: "activity",
              label: t("privacy.action.viewActivity"),
            })
          : button({ attributes: { id: "privacy-retry" }, label: t("privacy.action.tryAgain") })
      }
      ${backToWallet()}
    </div>
  </section>`;
};

type BlockedCopy = {
  readonly action: string;
  readonly body: string;
  readonly title: string;
};

// One screen per prerequisite, each ending in the next thing to do. The
// runtime's own message is shown beneath as the specific reason, so the
// classification never hides what was actually reported. Built per render so
// the copy follows the active language.
const blockedCopy = (kind: PrivacyBlockerKind): BlockedCopy => {
  switch (kind) {
    case "deploy":
      return {
        action: button({
          attributes: { "data-privacy-deploy-register": "" },
          icon: "shield",
          label: t("privacy.action.shield"),
        }),
        body: t("privacy.blocked.deploy.body"),
        title: t("privacy.blocked.deploy.title"),
      };
    case "fund":
      return {
        action: button({
          attributes: { "data-view": "receive" },
          icon: "qrCode",
          label: t("privacy.action.fundWithStrk"),
        }),
        body: t("privacy.blocked.fund.body"),
        title: t("privacy.blocked.fund.title"),
      };
    case "ledger":
      return {
        action: "",
        body: t("privacy.blocked.ledger.body"),
        title: t("privacy.blocked.ledger.title"),
      };
    case "network":
      return {
        action: button({
          attributes: { "data-view": "network" },
          icon: "globe",
          label: t("privacy.action.chooseNetwork"),
        }),
        body: t("privacy.blocked.network.body"),
        title: t("privacy.blocked.network.title"),
      };
    case "other-wallet":
      return { action: "", body: PRIVACY_OTHER_WALLET_NEXT, title: PRIVACY_OTHER_WALLET };
    case "pending":
      return {
        action: button({
          attributes: { "data-view": "activity" },
          icon: "activity",
          label: t("privacy.action.viewActivity"),
        }),
        body: t("privacy.blocked.pending.body"),
        title: t("privacy.blocked.pending.title"),
      };
    case "service":
      return {
        action: button({
          attributes: { id: "privacy-retry" },
          icon: "refresh",
          label: t("privacy.action.tryAgain"),
        }),
        body: t("privacy.blocked.service.body"),
        title: t("privacy.blocked.service.title"),
      };
  }
};

const blocked = (
  journey: Extract<PrivacyJourneyState, { readonly stage: "blocked" }>,
  disclosure: PrivacyDisclosureState | null,
): string => {
  const copy = blockedCopy(journey.blocker.kind);
  // The refusal names the missing STRK but not the amount. The fund screen is
  // the one place the reader can act on a number, so it states the pool fee the
  // registration needs when the disclosure has read one; a network-fee estimate
  // does not exist yet, so that cost is named without a figure.
  const poolFeeFri = journey.blocker.kind === "fund" ? disclosure?.value?.poolFeeFri : undefined;
  const requirement =
    poolFeeFri === undefined
      ? ""
      : `<p class="hint">${th("privacy.blocked.poolFeeNeeded", { fee: formatFri(poolFeeFri) })}</p>`;
  // The other-wallet screen is the two approved lines. The action refusal is a
  // different sentence and is not repeated under them.
  const reason =
    journey.blocker.kind === "other-wallet"
      ? ""
      : `<p class="hint">${escapeHtml(journey.blocker.message)}</p>`;
  return `
  <section class="privacy-outcome privacy-blocked" role="status" aria-live="polite" data-privacy-blocker="${journey.blocker.kind}">
    <span class="privacy-outcome-mark" aria-hidden="true">${icon("shield")}</span>
    <h2>${escapeHtml(copy.title)}</h2>
    <p>${escapeHtml(copy.body)}</p>
    ${reason}
    ${requirement}
    <div class="privacy-actions">
      ${copy.action}
      ${backToWallet()}
    </div>
  </section>`;
};

/**
 * Renders the current privacy checkpoint using the selected tracked token.
 */
export const privacyFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  journey: PrivacyJourneyState,
  disclosure: PrivacyDisclosureState | null = null,
): string => {
  const tokenId = journey.stage === "idle" ? null : journey.tokenId;
  const token =
    preferences?.tokens.find(
      (candidate) => candidate.id === tokenId && candidate.networkId === status.networkId,
    ) ?? null;
  const body =
    journey.stage === "activate-review"
      ? preparationDetails(journey, status)
      : journey.stage === "blocked"
        ? blocked(journey, disclosure)
        : journey.stage === "preparing"
          ? preparing(journey)
          : journey.stage === "working"
            ? working(journey)
            : journey.stage === "success"
              ? success(journey)
              : journey.stage === "failure"
                ? failure(journey)
                : emptyState(t("privacy.empty.chooseAsset"));
  return (
    flowHeader(
      journey.stage === "activate-review" ||
        journey.stage === "blocked" ||
        journey.stage === "preparing"
        ? t("privacy.header.goPrivate")
        : t("privacy.header.privateBalance"),
      status,
      token?.symbol ?? "STRK20",
    ) + flowScreen("privacy", `<section class="section privacy-flow">${body}</section>`)
  );
};
