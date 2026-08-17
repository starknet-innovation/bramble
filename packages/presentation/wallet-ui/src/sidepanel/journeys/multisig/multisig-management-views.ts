/** Focused add, signer, receive, and intent-import screens for Argent multisig. */
import { escapeHtml } from "@mc-wallet/core/html";
import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { textareaField, textField } from "@mc-wallet/ui-kit/fields";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountLabel, flowHeader, flowScreen, noAccountEmpty } from "../../shared/parts";
import { receiveAddressView } from "../send/receive-view";
import { argentMultisigContractLabel, multisigDisplayName } from "./multisig-views";

const setupOption = (
  view: "multisig-deploy" | "multisig-watch",
  iconName: "search" | "users",
  label: string,
  supportingText: string,
): string => `
  <button class="add-account-option multisig-setup-option" data-view="${view}" type="button">
    <span class="add-account-option-icon">${icon(iconName)}</span>
    <span class="add-account-option-copy"><strong>${label}</strong><span>${supportingText}</span></span>
    <span class="menu-chevron">${icon("chevronRight")}</span>
  </button>`;

/**
 * Renders the shared-account gateway without mutating chain state.
 */
export const multisigAddFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Argent Multisig", status, "True M-of-N signatures") +
  flowScreen(
    "multisig-add",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <div class="multisig-setup-options" role="group" aria-label="Argent multisig setup">
        ${setupOption("multisig-deploy", "users", "Create a new multisig", "Deploy the pinned Argent 0.2 account.")}
        ${setupOption("multisig-watch", "search", "Add a shared address", "Sync it now or complete deployment.")}
      </div>
    </section>`,
  );

/**
 * Renders address-only discovery; authority is read from chain and matched locally.
 */
export const multisigWatchFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Add Argent multisig", status, "Sync or complete an undeployed account") +
  flowScreen(
    "multisig-watch",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <form id="multisig-add-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          hint: "If deployed, signer authority syncs from Starknet. If not, the address is saved and deployment setup is verified before use.",
          label: "Multisig address",
          name: "address",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${button({ disabled: account === null, label: "Add multisig", type: "submit" })}
        <p id="multisig-add-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Renders fresh signer GUID authority, never stale setup claims.
 */
export const multisigSignersFlow = (
  status: WalletStatus,
  _account: AccountRef | null,
  view: ArgentMultisigView | null,
): string => {
  if (!view) {
    return (
      flowHeader("Signers", status) +
      flowScreen("multisig-signers", emptyState("This Argent multisig is no longer watched."))
    );
  }
  const { record, config } = view;
  return (
    flowHeader("Signers", status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-signers",
      `<section class="section">
        ${receipt([
          { label: "Contract", value: argentMultisigContractLabel() },
          { label: "Address", value: accountLabel(record.address), valueStyle: "code" },
          { label: "Required", value: config ? String(config.threshold) : "Unavailable" },
          {
            label: "Current signers",
            value: config ? String(config.signerGuids.length) : "Unavailable",
          },
        ])}
        ${
          config
            ? `<ol class="address-book">${config.signerGuids.map((guid) => `<li><code>${escapeHtml(guid)}</code></li>`).join("")}</ol>`
            : '<p class="review-flag" role="alert">Current signer authority could not be verified. Signing is disabled.</p>'
        }
      </section>
      <section class="section">
        <p class="hint">Removing stops local tracking only. It never changes the on-chain account.</p>
        ${button({ attributes: { "data-multisig-remove": record.id }, label: "Stop watching", variant: "ghost" })}
      </section>`,
    )
  );
};

/**
 * Renders the public shared receive address.
 */
export const multisigReceiveFlow = (
  status: WalletStatus,
  view: ArgentMultisigView | null,
): string => {
  if (!view) {
    return (
      flowHeader("Receive", status) +
      flowScreen("multisig-receive", emptyState("This Argent multisig is no longer watched."))
    );
  }
  return (
    flowHeader("Receive", status, multisigDisplayName(view.record)) +
    flowScreen(
      "multisig-receive",
      receiveAddressView({
        address: view.record.address,
        copyLabel: "Copy Argent multisig address",
        eyebrow: "Shared account",
        hint: `Send only Starknet assets on ${status.network}.`,
        title: multisigDisplayName(view.record),
      }),
    )
  );
};

/**
 * Renders full frozen-intent import for independent co-signers.
 */
export const multisigTrackFlow = (status: WalletStatus, view: ArgentMultisigView | null): string =>
  flowHeader("Import signing intent", status, view ? multisigDisplayName(view.record) : undefined) +
  flowScreen(
    "multisig-track",
    view
      ? `<section class="section">
          <p class="review-flag" role="note">Import only the full immutable package. The wallet re-hashes every signed field and requires this exact account, chain, nonce, class and current signer authority.</p>
          <form id="multisig-track-form">
            ${textareaField({ className: "mono", label: "Intent package", name: "intentPackage", required: true, rows: 8, spellcheck: false })}
            ${button({ label: "Verify and import", type: "submit" })}
            <p id="multisig-track-result" role="status"></p>
          </form>
        </section>`
      : emptyState("Select a watched Argent multisig first."),
  );
