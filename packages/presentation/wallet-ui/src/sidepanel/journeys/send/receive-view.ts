/** Shared account-address surface used by single-owner and multisig Receive. */
import { escapeHtml } from "@mc-wallet/core/html";
import { button } from "@mc-wallet/ui-kit/controls";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import { walletContactCard } from "@mc-wallet/wallet-model/preferences";
import { accountLabel, copyButton } from "../../shared/parts";
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
 * Renders the canonical Receive card. Its QR carries a versioned public wallet
 * card; the address and optional signer keys remain separately copyable.
 */
type ReceiveAddressViewOptions = {
  readonly address: string;
  readonly copyLabel: string;
  readonly eyebrow: string;
  readonly hint: string;
  readonly networkId: StarknetNetworkId;
  readonly nostrPublicKey?: string;
  readonly publicKeyX?: string;
  readonly qrLabel?: string;
  readonly title?: string;
};

/**
 * Renders the canonical Receive card. Callers provide account-type context as
 * escaped presentation copy and may expose one already-public signer key.
 */
export const receiveAddressView = ({
  address,
  copyLabel,
  eyebrow,
  hint,
  networkId,
  nostrPublicKey,
  publicKeyX,
  qrLabel,
  title,
}: ReceiveAddressViewOptions): string => {
  const walletCardReady = !publicKeyX || !!nostrPublicKey;
  const contactCard = walletContactCard({
    address,
    networkId,
    ...(nostrPublicKey ? { nostrPublicKey } : {}),
    ...(publicKeyX ? { publicKeyX } : {}),
  });
  return `
  <div class="stack receive-address-view"${publicKeyX ? ` data-receive-wallet-card data-receive-address="${escapeHtml(address)}" data-receive-network="${escapeHtml(networkId)}" data-receive-signer-key="${escapeHtml(publicKeyX)}" data-wallet-card-state="${walletCardReady ? "ready" : "preparing"}"` : ""}>
    <div class="qr-card" data-receive-qr${walletCardReady ? "" : ' aria-busy="true"'}>${walletCardReady ? qrSvg(contactCard, qrLabel ?? "QR code for wallet contact card") : '<p class="receive-card-pending" role="status">Preparing complete wallet card…</p>'}</div>
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    ${title ? `<h2>${escapeHtml(title)}</h2>` : ""}
    <div class="address-line">
      <code>${escapeHtml(address)}</code>
      ${copyButton(address, copyLabel)}
    </div>
    ${button({ attributes: { "data-copy": publicKeyX && !walletCardReady ? "" : publicKeyX ? contactCard : address, ...(publicKeyX ? { "data-wallet-card-copy": true } : {}) }, disabled: !walletCardReady, icon: "copy", label: publicKeyX && !walletCardReady ? "Preparing wallet card…" : publicKeyX ? "Copy wallet card" : copyLabel })}
    ${
      publicKeyX
        ? `<div class="receive-public-key">
            <div><strong>Signer public key</strong><span>Share this when another participant adds you to a multisig.</span></div>
            <div class="address-line">
              <code title="${escapeHtml(publicKeyX)}">${escapeHtml(accountLabel(publicKeyX))}</code>
              ${copyButton(publicKeyX, "Copy signer public key")}
            </div>
            <div data-nostr-key-row>
              <div><strong>Coordination public key</strong><span data-nostr-key-status role="status" aria-live="polite">${nostrPublicKey ? "Authenticates private multisig handoffs from this wallet." : "Preparing secure coordination…"}</span></div>
              <div class="address-line" data-nostr-key-value${nostrPublicKey ? "" : " hidden"}>
                <code data-nostr-key title="${escapeHtml(nostrPublicKey ?? "")}">${nostrPublicKey ? escapeHtml(accountLabel(nostrPublicKey)) : ""}</code>
                ${copyButton(nostrPublicKey ?? "", "Copy coordination public key")}
              </div>
            </div>
          </div>`
        : ""
    }
    <p class="hint">${escapeHtml(hint)}</p>
  </div>`;
};
