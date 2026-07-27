/**
 * Multisig declaration and deployment screen, split from the list/detail
 * templates so each security-sensitive renderer stays directly auditable.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { AccountRef } from "../storage/vault-schema";
import { pill } from "../ui/content";
import { button } from "../ui/controls";
import { textareaField, textField } from "../ui/fields";
import { icon } from "./icons";
import { accountLabel, flowHeader, flowScreen, hardwareBadge, noAccountEmpty } from "./parts";

// A picker of this wallet's accounts on the active network, each inserting its
// address into the signers field. It intentionally retains a domain-specific
// rich button because its code value and hardware badge are compound content.
const signerPicker = (status: WalletStatus): string => {
  const accounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  if (accounts.length === 0) {
    return "";
  }
  const rows = accounts
    .map(
      (stored) =>
        `<button class="secondary small" data-signer-insert="${escapeHtml(stored.address)}" type="button">${icon("plus")}<code>${escapeHtml(accountLabel(stored.address))}</code>${hardwareBadge(stored)}</button>`,
    )
    .join("");
  return `<div class="stack">
    <span class="hint">Add a signer from this wallet's accounts:</span>
    <div class="row wrap">${rows}</div>
  </div>`;
};

/**
 * Renders the deploy form for a new multisig from the pinned class, including
 * the declare-first path when the class is missing on the active network.
 */
export const multisigDeployFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  declared: boolean | "error" | null,
): string => {
  if (!account) {
    return (
      flowHeader("Deploy multisig", status) + flowScreen("multisig-deploy", noAccountEmpty(status))
    );
  }
  return (
    flowHeader("Deploy multisig", status) +
    flowScreen(
      "multisig-deploy",
      `<section class="section">
      ${
        declared === false
          ? `<div class="row">${pill("Class not declared")}</div>
             <p class="hint">The multisig class is not declared on ${escapeHtml(status.network)} yet. Declaring is a one-time, fee-paying transaction from your account; afterwards anyone can deploy from the same class.</p>
             ${button({
               attributes: { id: "multisig-declare" },
               icon: "send",
               label: "Declare multisig class",
               variant: "secondary",
             })}
             <p id="multisig-declare-result" role="status"></p>`
          : declared === "error"
            ? `<div class="row">${pill("Status unavailable")}</div>
               <p class="hint">Could not check whether the multisig class is declared on ${escapeHtml(status.network)} — the network may be unreachable.</p>
               ${button({
                 attributes: { id: "multisig-class-retry" },
                 icon: "refresh",
                 label: "Retry",
                 variant: "secondary",
               })}`
            : declared === null
              ? '<p class="hint">Checking whether the multisig class is declared on this network…</p>'
              : ""
      }
      <form id="multisig-deploy-form">
        ${textareaField({
          autocomplete: "off",
          className: "mono",
          label: "Signer addresses (one per line)",
          name: "signers",
          required: true,
          rows: 4,
          spellcheck: false,
          value: account.address,
        })}
        ${signerPicker(status)}
        ${textField({
          autocomplete: "off",
          inputmode: "numeric",
          label: "Quorum (confirmations required)",
          name: "quorum",
          required: true,
          value: "1",
        })}
        ${textField({
          autocomplete: "off",
          className: "mono",
          label: "Salt",
          name: "salt",
          spellcheck: false,
          value: "0x0",
        })}
        <span class="hint">The contract address is derived from the class, signers, quorum, and salt — the same inputs always produce the same address on every network. Name it after it finalizes, when you add it to your watched multisigs.</span>
        ${button({
          disabled: declared !== true,
          icon: "send",
          label: "Deploy multisig",
          type: "submit",
          variant: "secondary",
        })}
        <p id="multisig-deploy-result" role="status"></p>
      </form>
    </section>`,
    )
  );
};
