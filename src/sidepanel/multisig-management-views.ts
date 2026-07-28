/**
 * Focused multisig management subflows. Watching, signer inspection, and
 * shared-proposal tracking are separated from the proposal feed so each screen
 * has one task and one security boundary to understand.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { MultisigRecord } from "../storage/multisig-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState, receipt } from "../ui/content";
import { button } from "../ui/controls";
import { textField } from "../ui/fields";
import { multisigDisplayName, multisigSignerRow } from "./multisig-views";
import { accountLabel, copyButton, flowHeader, flowScreen, noAccountEmpty } from "./parts";
import { qrSvg } from "./qr";

/**
 * Renders watch-by-address as a focused membership verification task.
 */
export const multisigWatchFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Watch multisig", status, "Add a contract where this account is a signer") +
  flowScreen(
    "multisig-watch",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <form id="multisig-add-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          disabled: account === null,
          label: "Contract address",
          name: "address",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${textField({
          autocomplete: "off",
          disabled: account === null,
          label: "Name (optional)",
          maxlength: 48,
          name: "name",
        })}
        <p class="hint">The wallet reads signer and quorum state on-chain. The active account must be one of the signers.</p>
        ${button({
          disabled: account === null,
          icon: "check",
          label: "Verify and watch",
          type: "submit",
        })}
        <p id="multisig-add-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Renders signer and quorum inspection away from proposal actions.
 */
export const multisigSignersFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  record: MultisigRecord | null,
): string => {
  if (!record) {
    return (
      flowHeader("Signers & quorum", status) +
      flowScreen(
        "multisig-signers",
        `<section class="section">${emptyState("This multisig is no longer watched.")}</section>`,
      )
    );
  }
  return (
    flowHeader("Signers & quorum", status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-signers",
      `<section class="section">
        ${receipt([
          { label: "Required", value: `${record.quorum} confirmations` },
          { label: "Total signers", value: String(record.signers.length) },
          { label: "Contract", value: accountLabel(record.address), valueStyle: "code" },
        ])}
      </section>
      <section class="section">
        <p class="eyebrow">Current signers</p>
        <ul class="address-book">${record.signers
          .map((signer) => multisigSignerRow(signer, account, status.accounts))
          .join("")}</ul>
        <p class="hint">Signer and quorum changes require proposals sent by the multisig to itself.</p>
      </section>
      <section class="section">
        <p class="eyebrow">Wallet tracking</p>
        <p class="hint">This removes the shared account from this wallet only. It does not change the contract or signer set.</p>
        ${button({
          attributes: { "data-multisig-remove": record.id },
          icon: "x",
          label: "Stop watching this shared account",
          variant: "ghost",
        })}
      </section>`,
    )
  );
};

/**
 * Renders the shared account's receive address. The QR encodes only the
 * canonical public contract address; no signer or proposal data is included.
 */
export const multisigReceiveFlow = (
  status: WalletStatus,
  record: MultisigRecord | null,
): string => {
  if (!record) {
    return (
      flowHeader("Receive", status) +
      flowScreen(
        "multisig-receive",
        `<section class="section">${emptyState("This multisig is no longer watched.")}</section>`,
      )
    );
  }
  return (
    flowHeader("Receive", status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-receive",
      `<section class="section receive-card">
        <p class="eyebrow">Shared account</p>
        <h2>${escapeHtml(multisigDisplayName(record))}</h2>
        <div class="receive-qr">${qrSvg(record.address, "QR code for multisig address")}</div>
        <div class="receive-address"><code>${record.address}</code>${copyButton(record.address, "Copy multisig address")}</div>
        <p class="hint">Send only Starknet assets on ${escapeHtml(status.network)}. This address is controlled by the multisig's ${record.quorum}-of-${record.signers.length} approval rule.</p>
      </section>`,
    )
  );
};

/**
 * Renders shared-proposal tracking with the off-chain note warning directly
 * beside the proposal id.
 */
export const multisigTrackFlow = (status: WalletStatus, record: MultisigRecord | null): string => {
  if (!record) {
    return (
      flowHeader("Track proposal", status) +
      flowScreen(
        "multisig-track",
        `<section class="section">${emptyState("This multisig is no longer watched.")}</section>`,
      )
    );
  }
  return (
    flowHeader("Track proposal", status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-track",
      `<section class="section">
        <p class="review-flag" role="note">A pasted proposal id proves only that the proposal exists on-chain. Notes are local and never verify what the call does.</p>
        <form id="multisig-track-form">
          ${textField({
            autocomplete: "off",
            className: "mono",
            label: "Proposal id",
            name: "txId",
            placeholder: "0x…",
            required: true,
            spellcheck: false,
          })}
          ${textField({
            autocomplete: "off",
            label: "Local note (optional)",
            maxlength: 120,
            name: "summary",
          })}
          <p class="hint">Verify the proposal id with the proposer or a block explorer before confirming it.</p>
          ${button({
            icon: "check",
            label: "Verify and track",
            type: "submit",
          })}
          <p id="multisig-track-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};
