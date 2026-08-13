/**
 * Account-management rows for watched multisigs. Shared accounts use the same
 * avatar, hierarchy, hit target, and selection semantics as signer accounts;
 * opening one preserves its contract-account identity without changing the
 * vault's active signing account.
 */
import { escapeHtml } from "@mc-wallet/core/html";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import { icon } from "../../shared/icons";
import { accountAvatar, accountLabel } from "../../shared/parts";
import { multisigDisplayName } from "./multisig-model";

/**
 * Renders multisig identities inside the common Accounts & groups picker.
 */
export const multisigAccountOptions = (
  records: readonly ArgentMultisigView[],
  selectedMultisigId: string | null,
): string =>
  records
    .map(
      (
        view,
      ) => `<button class="option-row" data-multisig-open="${escapeHtml(view.record.id)}" type="button" aria-pressed="${view.record.id === selectedMultisigId}">
        <span class="option-avatar">${accountAvatar(view.record.address)}</span>
        <span class="option-copy">
          <strong>${escapeHtml(multisigDisplayName(view.record))}</strong>
          <code>${escapeHtml(accountLabel(view.record.address))}</code>
          <span class="option-sub">Argent Multisig · ${view.config ? `${view.config.threshold} of ${view.config.signerGuids.length}` : "authority unavailable"}</span>
        </span>
        ${view.record.id === selectedMultisigId ? `<span class="option-mark">${icon("check")}</span>` : ""}
      </button>`,
    )
    .join("");
