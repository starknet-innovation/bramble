/** Shared account-address surface used by single-owner and multisig Receive. */
import { escapeHtml } from "@bramble/core/html";
import { button } from "@bramble/ui-kit/controls";
import { icon } from "@bramble/ui-kit/icons";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { walletContactCard } from "@bramble/wallet-model/preferences";
import { accountLabel, copyButton } from "../../shared/parts";
import { qrSvg } from "../../shared/qr";
import type { PrivacyDisclosureState } from "../privacy/privacy-model";

const PUBLIC_ONLY_COPY = "Public transfers only";
const UNREGISTERED_COPY = "Enable private balances to receive privately.";
// Registration is an on-chain transaction from this account, so it needs a
// deployed contract and STRK for the fee. Naming the prerequisite beats offering
// a control whose only outcome is a failed estimate.
const PREREQUISITE_COPY = "Deploy this account and add STRK before enabling private balances.";
// Deployment and registration are two transactions — Starknet cannot batch a
// DEPLOY_ACCOUNT with an invoke — so the copy says so rather than implying one.
const DEPLOY_FIRST_COPY =
  "Enabling private balances takes two transactions: deploy, then register. Each has a network fee.";

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
        <span class="privacy-pool-copy"><strong>${escapeHtml(PUBLIC_ONLY_COPY)}</strong><span>${escapeHtml(PREREQUISITE_COPY)}</span></span>
      </p>`;
  }
  const deploying = action === "deploy-first";
  const hook = deploying ? "data-privacy-deploy-register" : "data-privacy-register";
  return `<button class="privacy-pool-notice" ${hook}="" type="button">
      <span class="privacy-pool-copy"><strong>${escapeHtml(PUBLIC_ONLY_COPY)}</strong><span>${escapeHtml(deploying ? DEPLOY_FIRST_COPY : UNREGISTERED_COPY)}</span></span>
      <strong>${deploying ? "Deploy and enable" : "Enable privacy"}</strong>
    </button>`;
};

/**
 * Renders the canonical Receive card. Its QR carries a versioned public wallet
 * card; the address and optional signer keys remain separately copyable.
 */
type ReceiveAddressViewOptions = {
  readonly address: string;
  readonly copyLabel: string;
  readonly hint: string;
  readonly networkId: StarknetNetworkId;
  readonly nostrPublicKey?: string;
  readonly publicKeyX?: string;
  readonly qrLabel?: string;
};

/**
 * Renders the canonical Receive card. Callers provide account-type context as
 * escaped presentation copy and may expose one already-public signer key.
 */
export const receiveAddressView = ({
  address,
  copyLabel,
  hint,
  networkId,
  nostrPublicKey,
  publicKeyX,
  qrLabel,
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
    <div class="receive-intro">
      <h2>Your Starknet address</h2>
      <p>${escapeHtml(hint)}</p>
    </div>
    <div class="receive-actions">
      ${button({ attributes: { "data-copy": address }, icon: "copy", label: copyLabel })}
      ${
        publicKeyX
          ? button({
              attributes: {
                "data-copy": walletCardReady ? contactCard : "",
                "data-wallet-card-copy": true,
              },
              disabled: !walletCardReady,
              icon: "copy",
              label: walletCardReady ? "Copy wallet card" : "Preparing card…",
              variant: "secondary",
            })
          : ""
      }
    </div>
    ${
      publicKeyX
        ? `<details class="disclosure receive-identity" data-disclosure="receive-identity">
            <summary>
              <span class="menu-copy"><strong>Wallet identity</strong><small>Signer and coordination keys</small></span>
              <span class="disclosure-mark">${icon("chevronRight")}</span>
            </summary>
            <div class="disclosure-body receive-public-key">
              <div class="receive-key-row">
                <strong>Signer public key</strong>
                <span class="receive-key-value">
                  <code title="${escapeHtml(publicKeyX)}">${escapeHtml(accountLabel(publicKeyX))}</code>
                  ${copyButton(publicKeyX, "Copy signer public key")}
                </span>
              </div>
              <div class="receive-key-row" data-nostr-key-row>
                <strong>Coordination public key</strong>
                <span data-nostr-key-status role="status" aria-live="polite"${nostrPublicKey ? " hidden" : ""}>Preparing secure coordination…</span>
                <span class="receive-key-value" data-nostr-key-value${nostrPublicKey ? "" : " hidden"}>
                  <code data-nostr-key title="${escapeHtml(nostrPublicKey ?? "")}">${nostrPublicKey ? escapeHtml(accountLabel(nostrPublicKey)) : ""}</code>
                  ${copyButton(nostrPublicKey ?? "", "Copy coordination public key")}
                </span>
              </div>
            </div>
          </details>`
        : ""
    }
  </div>`;
};
