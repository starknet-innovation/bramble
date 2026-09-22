/** Shared account-address surface used by single-owner and multisig Receive. */
import { escapeHtml } from "@bramble/core/html";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import { button, switchControl } from "@bramble/ui-kit/controls";
import { icon } from "@bramble/ui-kit/icons";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { walletContactCard } from "@bramble/wallet-model/preferences";
import { accountLabel, copyButton } from "../../shared/parts";
import { qrSvg } from "../../shared/qr";
import { knownAccountType } from "../../shell/account-types";
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
 * Renders the on-chain class-hash verification state shown beneath the account's
 * class hash. `null` is the still-loading state (kept visually distinct from a
 * confirmed result); a `mismatch` is a security signal and is surfaced as an
 * assertive alert. Only an exact on-chain match reads as verified.
 */
export const classHashVerificationBadge = (verification: ClassHashVerification | null): string => {
  if (verification === null) {
    return `<p class="verify-status pending" role="status">${icon("refresh")}Verifying on-chain…</p>`;
  }
  switch (verification.status) {
    case "verified":
      return `<p class="verify-status verified" role="status">${icon("shield")}Verified on-chain</p>`;
    case "mismatch":
      return `<p class="verify-status mismatch" role="alert">${icon("alert")}On-chain mismatch — the contract deployed at this address runs class <code>${escapeHtml(verification.onChainClassHash)}</code>, not the class shown above. Do not trust this account until resolved.</p>`;
    case "undeployed":
      return `<p class="verify-status pending" role="status">${icon("alert")}Not deployed yet — the class hash cannot be verified on-chain until this account is deployed.</p>`;
    case "unreachable":
      return `<p class="verify-status pending" role="status">${icon("alert")}Could not reach the network — shown from local data and not yet verified on-chain.</p>`;
  }
};

// A mismatch says "do not trust this account", so it is the one verdict that
// cannot sit behind the Pro switch: Pro renders collapsed, and a security signal
// nobody opens is a signal nobody gets. It is hoisted to the top of the card and
// left out of the Pro rows, so exactly one badge renders either way.
const isMismatch = (verification: ClassHashVerification | null | undefined): boolean =>
  verification?.status === "mismatch";

// The contract identifiers: the class this account runs, its familiar name when
// the registry knows that class, and the on-chain verdict for it. Rendered
// inside Pro beside the public keys, because a class hash answers "what am I
// handing you" the same way the address and signer key do. Omitted entirely
// when the caller passes no class hash (a watched multisig's Receive).
const classHashRows = (
  classHash: string | undefined,
  verification: ClassHashVerification | null | undefined,
): string => {
  if (!classHash) {
    return "";
  }
  const accountType = knownAccountType(classHash);
  return `<div class="receive-key-row">
      <strong>Class hash</strong>
      <span class="receive-key-value">
        <code title="${escapeHtml(classHash)}">${escapeHtml(accountLabel(classHash))}</code>
        ${copyButton(classHash, "Copy class hash")}
      </span>
    </div>
    ${
      accountType
        ? `<div class="receive-key-row">
      <strong>Type</strong>
      <span class="receive-key-value">${escapeHtml(accountType)}</span>
    </div>`
        : ""
    }
    ${verification === undefined || isMismatch(verification) ? "" : classHashVerificationBadge(verification)}`;
};

/**
 * Accessible names of the two QR payloads Receive can show. Shared with the
 * shell binding that swaps between them, so the label and the payload cannot
 * drift apart.
 */
export const RECEIVE_QR_LABELS = {
  address: "QR code for your Starknet address",
  card: "QR code for wallet contact card",
} as const;

// The contact card is a public document; saying so keeps the signer and
// coordination keys from reading as secrets when they appear beside it.
const CARD_EXPLAINER =
  "The contact card is public: this address, the signer public key, and the coordination public key. It holds nothing secret.";

/**
 * Renders the canonical Receive card. The QR carries the plain Starknet
 * address by default — the payload every other wallet can read — and the
 * address is shown in full beside it. An account with a signer key can switch
 * the QR to the versioned Bramble contact card once that card is complete;
 * preparing or failing to prepare it never blocks the address.
 */
type ReceiveAddressViewOptions = {
  readonly address: string;
  /** Class this account's contract runs; omitted where the caller has none. */
  readonly classHash?: string;
  /** On-chain verdict for that class; `null` while it is still being checked. */
  readonly classHashVerification?: ClassHashVerification | null;
  readonly copyLabel: string;
  readonly hint: string;
  readonly networkId: StarknetNetworkId;
  /** Display name of the network, shown beside the address when provided. */
  readonly networkName?: string;
  readonly nostrPublicKey?: string;
  readonly publicKeyX?: string;
};

/**
 * Renders the canonical Receive card. Callers provide account-type context as
 * escaped presentation copy and may expose one already-public signer key. A
 * caller that knows the account's class hash passes it too: it is public
 * contract metadata, and Pro is where the wallet hands out the identifiers
 * someone may need to check what they are paying into.
 */
export const receiveAddressView = ({
  address,
  classHash,
  classHashVerification,
  copyLabel,
  hint,
  networkId,
  networkName,
  nostrPublicKey,
  publicKeyX,
}: ReceiveAddressViewOptions): string => {
  const walletCardReady = !publicKeyX || !!nostrPublicKey;
  const contactCard = walletContactCard({
    address,
    networkId,
    ...(nostrPublicKey ? { nostrPublicKey } : {}),
    ...(publicKeyX ? { publicKeyX } : {}),
  });
  const rootData = publicKeyX
    ? ` data-receive-wallet-card data-receive-address="${escapeHtml(address)}" data-receive-network="${escapeHtml(networkId)}" data-receive-signer-key="${escapeHtml(publicKeyX)}" data-wallet-card-state="${walletCardReady ? "ready" : "preparing"}"${walletCardReady ? ` data-receive-card="${escapeHtml(contactCard)}"` : ""}`
    : "";
  return `
  <div class="stack receive-address-view"${rootData}>
    ${classHash && isMismatch(classHashVerification) ? classHashVerificationBadge(classHashVerification ?? null) : ""}
    <div class="qr-card" data-receive-qr data-qr-payload="address">${qrSvg(address, RECEIVE_QR_LABELS.address)}</div>
    <div class="receive-intro">
      <h2>Your Starknet address</h2>
      <button class="receive-address-copy" type="button" data-copy="${escapeHtml(address)}" aria-label="${escapeHtml(copyLabel)}" aria-describedby="receive-address-text" title="${escapeHtml(copyLabel)}">
        <code id="receive-address-text" data-receive-address-text>${escapeHtml(address)}</code>
        <span class="receive-address-copy-mark" aria-hidden="true">${icon("copy")}</span>
      </button>
      ${networkName ? `<p class="receive-network">Network: <strong>${escapeHtml(networkName)}</strong></p>` : ""}
    </div>
    ${
      publicKeyX
        ? `${switchControl({
            attributes: { id: "receive-pro" },
            label: "Pro",
          })}
      <div class="receive-pro-fields" id="receive-pro-fields" hidden>
        <p class="hint">${escapeHtml(hint)}</p>
        <div class="seg receive-payload-switch" role="group" aria-label="QR code contents" data-receive-payload-switch>
          <button class="seg-option" type="button" aria-pressed="true" data-receive-payload="address">Address</button>
          <button class="seg-option" type="button" aria-pressed="false" data-receive-payload="card"${walletCardReady ? "" : " disabled"}>Bramble contact card</button>
        </div>
        <p class="hint receive-card-explainer" data-receive-card-explainer>${escapeHtml(CARD_EXPLAINER)}</p>
        <div class="receive-actions">
          ${button({
            attributes: {
              "data-copy": walletCardReady ? contactCard : "",
              "data-wallet-card-copy": true,
            },
            disabled: !walletCardReady,
            icon: "copy",
            label: walletCardReady ? "Copy wallet card" : "Preparing card…",
            variant: "secondary",
          })}
        </div>
        <div class="receive-public-key">
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
          ${classHashRows(classHash, classHashVerification)}
        </div>
      </div>`
        : `<p class="hint">${escapeHtml(hint)}</p>`
    }
  </div>`;
};
