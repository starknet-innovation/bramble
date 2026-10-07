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
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { networkDisplayName } from "../../shared/network-label";
import { flowHeader, flowScreen, formatFri } from "../../shared/parts";
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
export const PROVING_HINT =
  "Keep the wallet open. Proving may take longer than a normal token transfer.";

/**
 * The liveness line of a wait: the job's phase and elapsed time when it has
 * reported one, ahead of the standing hint. The phase is a fixed label from the
 * closed vocabulary and the time a number, so this is text, never markup. Both
 * the template and the in-place update on every poll read it from here.
 */
export const privacyLivenessText = (
  progress: PreparationProgress | null | undefined,
  hint: string = PROVING_HINT,
): string => (progress ? `${preparationProgressText(progress)}. ${hint}` : hint);

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
const PREPARING_COPY: Readonly<
  Record<PreparingStep, { readonly body: string; readonly hint: string; readonly title: string }>
> = {
  discovering: {
    body: "",
    hint: "Keep the wallet open.",
    title: "Checking private balances",
  },
  proving: {
    body: "No transaction is signed or sent until you confirm the review. Going back discards this preparation.",
    hint: PROVING_HINT,
    title: "Preparing to go private",
  },
};

const preparing = (
  journey: Extract<PrivacyJourneyState, { readonly stage: "preparing" }>,
): string => {
  const copy = PREPARING_COPY[journey.step];
  const proving = journey.step === "proving";
  return `
  <section class="privacy-working" role="status" aria-live="polite" data-privacy-preparing="${journey.step}">
    ${liquidDots("privacy")}${liquidDotsFilter("privacy")}
    <h2>${escapeHtml(copy.title)}</h2>
    ${copy.body === "" ? "" : `<p>${escapeHtml(copy.body)}</p>`}
    <ol class="privacy-task-list">
      <li data-state="${proving ? "done" : "active"}"><span></span>Check registration</li>
      <li data-state="${proving ? "active" : "pending"}"><span></span>Build registration proof</li>
      <li data-state="pending"><span></span>Review and confirm</li>
      <li data-state="pending"><span></span>Broadcast to Starknet</li>
    </ol>
    <p class="hint" id="privacy-liveness">${escapeHtml(privacyLivenessText(journey.progress, copy.hint))}</p>
    <div class="privacy-actions">
      ${button({ attributes: { id: "privacy-cancel" }, label: "Back to wallet", variant: "secondary" })}
    </div>
  </section>`;
};

const shortAddress = (value: string): string =>
  value.length <= 15 ? value : `${value.slice(0, 8)}…${value.slice(-5)}`;

const preparationDetails = (
  journey: Extract<PrivacyJourneyState, { readonly stage: "activate-review" }>,
  status: WalletStatus,
): string => {
  const { preparation } = journey;
  return `<section class="privacy-review">
    <header class="decision-head">
      <span class="decision-seal">${icon("shield")}</span>
      <span><p class="decision-label">Reviewed intent</p><h2>Activate private balances</h2></span>
    </header>
    <section class="decision-layer decision-outcome" aria-label="What will happen">
      <p class="decision-label">What will happen</p>
      <p>This one-time registration lets this account discover and use its private notes.</p>
    </section>
    ${reviewPanel([
      "Registration is public. It stores this account's viewing-key commitment on-chain and opens its private channel. It does not reveal the viewing key or your private balance.",
    ])}
    <section class="decision-layer decision-boundary" aria-label="Cost">
      <p class="decision-label">Cost</p>
      ${receipt([
        {
          label: "Maximum network fee",
          value: preparation.networkFee
            ? formatFeeEstimate(preparation.networkFee)
            : preparation.route === "private-relay"
              ? "Sponsored"
              : "Unavailable",
        },
        ...(preparation.poolFeeFri
          ? [{ label: "Pool fee", value: `${formatFri(preparation.poolFeeFri)} from public STRK` }]
          : []),
        {
          label: "Submission",
          value:
            preparation.route === "private-relay" ? "Private relay" : "Public account transaction",
        },
      ])}
    </section>
    <details class="send-review-disclosure" data-disclosure="privacy-activation-technical">
      <summary><span>Technical details</span>${icon("chevronDown")}</summary>
      <div class="send-review-disclosure-body">
    ${receipt([
      { label: "Network", value: networkDisplayName(status.network) },
      ...(preparation.authorization
        ? [
            {
              label: "Public approval calls",
              value: String(preparation.authorization.publicCallCount),
            },
            {
              label: "Authorization window",
              value: `${shortAddress(preparation.authorization.executeAfter)} → ${shortAddress(preparation.authorization.executeBefore)}`,
              valueStyle: "code" as const,
            },
            {
              action: {
                attributes: { "data-copy": preparation.authorization.caller },
                icon: "copy" as const,
                label: "Copy authorization caller address",
              },
              label: "Authorization caller",
              value: shortAddress(preparation.authorization.caller),
              valueStyle: "code" as const,
            },
          ]
        : []),
      {
        action: {
          attributes: { "data-copy": preparation.poolAddress },
          icon: "copy",
          label: "Copy privacy pool address",
        },
        label: "Privacy pool",
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
      label: "Activate private balances",
    })}
  </section>`;
};

const working = (journey: Extract<PrivacyJourneyState, { readonly stage: "working" }>): string => `
  <section class="privacy-working" role="status" aria-live="polite">
    ${liquidDots("privacy")}${liquidDotsFilter("privacy")}
    <h2>Activating private balances</h2>
    <p>Generating the registration proof, waiting for your authorization, then broadcasting.</p>
    <ol class="privacy-task-list">
      <li data-state="done"><span></span>Review complete</li>
      <li data-state="active"><span></span>Generate proof and authorize</li>
      <li data-state="pending"><span></span>Broadcast to Starknet</li>
      <li data-state="pending"><span></span>Discover private balance</li>
    </ol>
    <p class="hint" id="privacy-liveness">${escapeHtml(privacyLivenessText(journey.progress))}</p>
  </section>`;

const success = (journey: Extract<PrivacyJourneyState, { readonly stage: "success" }>): string => `
  <section class="privacy-outcome privacy-success" role="status" aria-live="polite">
    <span class="privacy-outcome-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg></span>
    <h2>Registered</h2>
    <p>You can now shield ${escapeHtml(journey.symbol)} from its asset screen.</p>
    <div class="privacy-actions">
      ${button({ attributes: { id: "privacy-done" }, label: "Back to wallet", variant: "secondary" })}
      ${button({ attributes: { "data-view": "activity" }, icon: "activity", label: "View activity", variant: "secondary" })}
    </div>
  </section>`;

const failure = (journey: Extract<PrivacyJourneyState, { readonly stage: "failure" }>): string => {
  // A submission whose reply was lost is a warning, not a failure: it may still
  // be on chain, so it leads with Activity rather than the Try again a failure
  // offers (issue 382). The mark switches to the "!" the send receipt uses.
  const warning = journey.severity === "warning";
  return `
  <section class="privacy-outcome privacy-failure" role="alert" aria-live="assertive" data-severity="${journey.severity}">
    <span class="privacy-outcome-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><circle class="send-failure-ring" cx="28" cy="28" r="25" /><path class="send-failure-mark" d="m20 20 16 16m0-16L20 36" /><path class="privacy-unknown-mark" d="M28 17v13m0 8v1" /></svg></span>
    <h2>${warning ? "Status unknown" : "Private transaction not completed"}</h2>
    <p>${escapeHtml(journey.error)}</p>
    ${
      warning
        ? ""
        : '<p class="hint">No retry was submitted automatically. Check that your account is deployed and recent balance changes have settled, then try again.</p>'
    }
    <div class="privacy-actions">
      ${
        warning
          ? button({
              attributes: { "data-view": "activity" },
              icon: "activity",
              label: "View activity",
            })
          : button({ attributes: { id: "privacy-retry" }, label: "Try again" })
      }
      ${button({ attributes: { id: "privacy-cancel" }, label: "Back to wallet", variant: "secondary" })}
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
// classification never hides what was actually reported.
const BLOCKED_COPY: Readonly<Record<PrivacyBlockerKind, BlockedCopy>> = {
  deploy: {
    action: button({
      attributes: { "data-privacy-deploy-register": "" },
      icon: "shield",
      label: "Shield",
    }),
    body: "Registration is a transaction sent by this account, so its contract has to exist on Starknet first. Deploying and registering are two transactions, each with a network fee.",
    title: "Deploy this account first",
  },
  fund: {
    action: button({
      attributes: { "data-view": "receive" },
      icon: "qrCode",
      label: "Fund with STRK",
    }),
    body: "Going private requires your account to be funded and activated.",
    title: "Initialize your account",
  },
  ledger: {
    action: "",
    body: "Private balances need a viewing key that a Ledger device does not expose to the wallet. Use a software account to shield.",
    title: "Not available for Ledger accounts",
  },
  network: {
    action: button({
      attributes: { "data-view": "network" },
      icon: "globe",
      label: "Choose a network",
    }),
    body: "Switch to a network with a privacy pool.",
    title: "Not available on this network",
  },
  pending: {
    action: button({
      attributes: { "data-view": "activity" },
      icon: "activity",
      label: "View activity",
    }),
    body: "Your registration is on Starknet, waiting to be indexed. Shielding unlocks on its own — don't register again.",
    title: "Registration is on its way",
  },
  service: {
    action: button({ attributes: { id: "privacy-retry" }, icon: "refresh", label: "Try again" }),
    body: "The privacy service could not be reached or refused the request. Nothing was submitted.",
    title: "Private balances unavailable",
  },
};

const blocked = (
  journey: Extract<PrivacyJourneyState, { readonly stage: "blocked" }>,
  disclosure: PrivacyDisclosureState | null,
): string => {
  const copy = BLOCKED_COPY[journey.blocker.kind];
  // The refusal names the missing STRK but not the amount. The fund screen is
  // the one place the reader can act on a number, so it states the pool fee the
  // registration needs when the disclosure has read one; a network-fee estimate
  // does not exist yet, so that cost is named without a figure.
  const poolFeeFri = journey.blocker.kind === "fund" ? disclosure?.value?.poolFeeFri : undefined;
  const requirement =
    poolFeeFri === undefined
      ? ""
      : `<p class="hint">Registration needs ${escapeHtml(formatFri(poolFeeFri))} for the pool fee, plus a network fee.</p>`;
  return `
  <section class="privacy-outcome privacy-blocked" role="status" aria-live="polite" data-privacy-blocker="${journey.blocker.kind}">
    <span class="privacy-outcome-mark" aria-hidden="true">${icon("shield")}</span>
    <h2>${escapeHtml(copy.title)}</h2>
    <p>${escapeHtml(copy.body)}</p>
    <p class="hint">${escapeHtml(journey.blocker.message)}</p>
    ${requirement}
    <div class="privacy-actions">
      ${copy.action}
      ${button({ attributes: { id: "privacy-cancel" }, label: "Back to wallet", variant: "secondary" })}
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
                : emptyState("Choose an asset to begin.");
  return (
    flowHeader(
      journey.stage === "activate-review" ||
        journey.stage === "blocked" ||
        journey.stage === "preparing"
        ? "Go private"
        : "Private balance",
      status,
      token?.symbol ?? "STRK20",
    ) + flowScreen("privacy", `<section class="section privacy-flow">${body}</section>`)
  );
};
