/**
 * Account-management rows for watched multisigs. Shared accounts use the same
 * avatar, hierarchy, hit target, and selection semantics as signer accounts;
 * opening one preserves its contract-account identity without changing the
 * vault's active signing account.
 */
import { escapeHtml } from "../shared/html";
import type { MultisigRecord } from "../storage/multisig-store";
import { icon } from "./icons";
import { multisigDisplayName } from "./multisig-model";
import { accountAvatar, accountLabel } from "./parts";

/**
 * Renders multisig identities inside the common Accounts & groups picker.
 */
export const multisigAccountOptions = (
  records: readonly MultisigRecord[],
  selectedMultisigId: string | null,
): string =>
  records
    .map(
      (
        record,
      ) => `<button class="option-row" data-multisig-open="${escapeHtml(record.id)}" type="button" aria-pressed="${record.id === selectedMultisigId}">
        <span class="option-avatar">${accountAvatar(record.address)}</span>
        <span class="option-copy">
          <strong>${escapeHtml(multisigDisplayName(record))}</strong>
          <code>${escapeHtml(accountLabel(record.address))}</code>
          <span class="option-sub">Multisig · ${record.quorum} of ${record.signers.length} signers</span>
        </span>
        ${record.id === selectedMultisigId ? `<span class="option-mark">${icon("check")}</span>` : ""}
      </button>`,
    )
    .join("");
