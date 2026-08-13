/** Focused add, signer, receive, and intent-import screens for Argent multisig. */
import { escapeHtml } from "@mc-wallet/core/html";
import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { selectField, textareaField, textField } from "@mc-wallet/ui-kit/fields";
import { menuRow } from "@mc-wallet/ui-kit/navigation";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import {
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  noAccountEmpty,
} from "../../shared/parts";
import { receiveAddressView } from "../send/receive-view";
import { argentMultisigContractLabel, multisigDisplayName } from "./multisig-views";

const signerOptions = (
  status: WalletStatus,
): readonly { readonly label: string; readonly value: string }[] =>
  status.accounts
    .filter((account) => account.networkId === status.networkId)
    .map((account) => ({ label: accountDisplayName(account, null), value: account.id }));

/**
 * Renders the shared-account gateway without mutating chain state.
 */
export const multisigAddFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Argent Multisig", status, "True M-of-N account signatures") +
  flowScreen(
    "multisig-add",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <div class="menu-list" role="group" aria-label="Argent multisig setup">
        ${menuRow({
          attributes: { "data-view": "multisig-deploy" },
          icon: "users",
          label: "Create a new multisig",
          supportingText: "Deploy the pinned Argent Multisig 0.2 account.",
        })}
        ${menuRow({
          attributes: { "data-view": "multisig-watch" },
          icon: "search",
          label: "Add an existing multisig",
          supportingText: "Verify its full constructor and current signer authority.",
        })}
      </div>
    </section>`,
  );

/**
 * Renders current-authority registration; an address alone is never trusted.
 */
export const multisigWatchFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Add Argent multisig", status, "Verify current signer authority") +
  flowScreen(
    "multisig-watch",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <form id="multisig-add-form">
        ${textField({ label: "Name (optional)", maxlength: 48, name: "name" })}
        ${textField({ className: "mono", label: "Multisig address", name: "address", required: true, spellcheck: false })}
        ${textField({
          className: "mono",
          hint: "One canonical public key per line for the current on-chain signer set.",
          label: "Current signer public keys",
          name: "signerPublicKeys",
          placeholder: "0x123 0x456",
          required: true,
          spellcheck: false,
        })}
        ${textField({ inputmode: "numeric", label: "Signatures required", name: "threshold", required: true, value: "1" })}
        ${selectField({ label: "Signer in this wallet", name: "signerAccountId", options: signerOptions(status), required: true })}
        <p class="hint">The wallet checks the pinned class, compares the exact live signer GUID set and threshold, and verifies the selected local signer.</p>
        ${button({ disabled: account === null, label: "Verify and add", type: "submit" })}
        <p id="multisig-add-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Renders fresh signer GUID authority, never stale constructor claims.
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
