/**
 * Account-management rows for watched multisigs. Shared accounts use the same
 * avatar, hierarchy, hit target, and selection semantics as signer accounts;
 * opening one preserves its contract-account identity without changing the
 * vault's active signing account.
 */
import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import { icon } from "../../shared/icons";
import { accountAvatar, accountLabel, inlineCopyButton } from "../../shared/parts";
import { multisigDisplayName } from "./multisig-model";

/**
 * Renders multisig identities inside the common Accounts & groups picker. Each
 * row is the open control, so the address copy trails the row on the same
 * line rather than nesting inside the button.
 */
export const multisigAccountOptions = (
  records: readonly ArgentMultisigView[],
  selectedMultisigId: string | null,
): string =>
  records
    .map((view) => {
      const name = multisigDisplayName(view.record);
      return `<div class="option-row-line">
        <button class="option-row" data-multisig-open="${escapeHtml(view.record.id)}" type="button" aria-pressed="${view.record.id === selectedMultisigId}">
          <span class="option-avatar">${accountAvatar(view.record.address)}</span>
          <span class="option-copy">
            <strong>${escapeHtml(name)}</strong>
            <code title="${escapeHtml(view.record.address)}">${escapeHtml(accountLabel(view.record.address))}</code>
            <span class="option-sub">Ready Multisig · ${view.config ? `${view.config.threshold} of ${view.config.signerGuids.length}${view.authorityStatus === "unsupported-signers" ? " · watch only" : ""}` : view.authorityStatus === "undeployed" ? "not deployed" : "authority unavailable"}</span>
          </span>
          ${view.record.id === selectedMultisigId ? `<span class="option-mark">${icon("check")}</span>` : ""}
        </button>
        ${inlineCopyButton(view.record.address, `Copy ${name} address`)}
      </div>`;
    })
    .join("");
