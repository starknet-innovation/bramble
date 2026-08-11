/** Shared account-address surface used by single-owner and multisig Receive. */
import { escapeHtml } from "@mc-wallet/core/html";
import { button } from "@mc-wallet/ui-kit/controls";
import { copyButton } from "../../shared/parts";
import { qrSvg } from "../../shared/qr";
import type { PrivacyDisclosureState } from "../privacy/privacy-model";

const UNREGISTERED_COPY =
  "You are not registered to the Starknet privacy pool yet. You can only receive tokens publicly.";
// Registration is an on-chain transaction from this account, so it needs a
// deployed contract and STRK for the fee. Naming the prerequisite beats offering
// a control whose only outcome is a failed estimate.
const PREREQUISITE_COPY =
  "Registering is an on-chain transaction, so this account needs to be deployed and hold STRK first.";
// Deployment and registration are two transactions — Starknet cannot batch a
// DEPLOY_ACCOUNT with an invoke — so the copy says so rather than implying one.
const DEPLOY_FIRST_COPY =
  "This account is not on-chain yet. Deploying it and registering are two transactions, each with its own fee.";

/**
 * Whether the account can act on the privacy-pool notice, and if not, why.
 * `deploy-first` is actionable — deployment and registration run in sequence —
 * while `fund-first` has nothing to offer until STRK arrives.
 */
export type PoolNoticeAction = "deploy-first" | "fund-first" | "register";

/**
 * Renders the privacy-pool notice for an account that cannot receive shielded
 * value yet. Rendered only on a settled `unregistered` reading: while discovery
 * is loading or unavailable the wallet stays silent rather than asserting a
 * registration state it has not confirmed.
 *
 * `register` and `deploy-first` both land on the identical registration review —
 * the latter deploys the account contract first, because a registration is an
 * invoke and the account has to exist to send one. `fund-first` is plain text
 * with the prerequisite spelled out and nothing to click, since the only outcome
 * of offering it would be a failed fee estimate.
 */
export const privacyPoolNotice = (
  privacy: PrivacyDisclosureState,
  action: PoolNoticeAction = "register",
): string => {
  if (privacy.value?.registration !== "unregistered") {
    return "";
  }
  if (action === "fund-first") {
    return `<p class="privacy-pool-notice is-static">
        <span>${escapeHtml(UNREGISTERED_COPY)}</span>
        <span>${escapeHtml(PREREQUISITE_COPY)}</span>
      </p>`;
  }
  const deploying = action === "deploy-first";
  const hook = deploying ? "data-privacy-deploy-register" : "data-privacy-register";
  return `<button class="privacy-pool-notice" ${hook}="" type="button">
      <span>${escapeHtml(UNREGISTERED_COPY)}</span>
      ${deploying ? `<span>${escapeHtml(DEPLOY_FIRST_COPY)}</span><strong>Deploy and register</strong>` : "<strong>Register now</strong>"}
    </button>`;
};

/**
 * Renders the canonical Receive card. Only the public address is encoded and
 * copied; callers provide account-type context as escaped presentation copy.
 */
type ReceiveAddressViewOptions = {
  readonly address: string;
  readonly copyLabel: string;
  readonly eyebrow: string;
  readonly hint: string;
  readonly qrLabel?: string;
  readonly title?: string;
};

/**
 * Renders the canonical Receive card. Only the public address is encoded and
 * copied; callers provide account-type context as escaped presentation copy.
 */
export const receiveAddressView = ({
  address,
  copyLabel,
  eyebrow,
  hint,
  qrLabel,
  title,
}: ReceiveAddressViewOptions): string => `
  <div class="stack receive-address-view">
    <div class="qr-card">${qrSvg(address, qrLabel)}</div>
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    ${title ? `<h2>${escapeHtml(title)}</h2>` : ""}
    <div class="address-line">
      <code>${escapeHtml(address)}</code>
      ${copyButton(address, copyLabel)}
    </div>
    ${button({ attributes: { "data-copy": address }, icon: "copy", label: copyLabel })}
    <p class="hint">${escapeHtml(hint)}</p>
  </div>`;
