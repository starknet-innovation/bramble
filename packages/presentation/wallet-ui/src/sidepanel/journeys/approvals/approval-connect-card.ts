/**
 * Connection-request card. One account on the network keeps the identity row.
 * More than one account, or a multisig on this network, lists a choice, and
 * the decision reports the selected id.
 */

import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { accountDisplayName, accountLabel, inlineCopyButton } from "../../shared/parts";
import { reviewConstraints, reviewOutcome, reviewPanel } from "../../shared/review-render";
import { decisionRow, requestIdentity } from "./approval-card-parts";

/** Accounts and multisigs the connection card may offer. */
export type ConnectPicker = {
  readonly multisigs?: readonly ArgentMultisigView[];
  readonly selectedMultisigId?: string | null;
};

type ConnectChoice = {
  readonly address: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
};

// The account that approving will share is named on the card face and echoed
// back with the decision so the background can refuse if it moved.
const connectIdentity = (status: WalletStatus, preferences: WalletPreferences | null): string => {
  const account = status.accounts.find((candidate) => candidate.id === status.activeAccountId);
  if (!account) {
    return `<p class="hint">${status.locked ? "Unlock the wallet to see which account will be shared." : "Select an account on this network to share it."}</p>`;
  }
  return `<dl class="request-detail"><div><dt>Account</dt><dd class="request-account"><strong>${escapeHtml(accountDisplayName(account, preferences))}</strong><span class="copy-line"><code title="${escapeHtml(account.address)}">${escapeHtml(accountLabel(account.address))}</code>${inlineCopyButton(account.address, "Copy account address")}</span></dd></div><div><dt>Network</dt><dd>${escapeHtml(status.network)}</dd></div></dl>`;
};

const connectChoices = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  picker: ConnectPicker | undefined,
): readonly ConnectChoice[] => {
  const hidden = new Set(preferences?.hiddenAccountIds ?? []);
  const accounts = status.accounts
    .filter((account) => account.networkId === status.networkId && !hidden.has(account.id))
    .map((account) => ({
      address: account.address,
      id: account.id,
      kind: "account",
      name: accountDisplayName(account, preferences),
    }));
  const shared = (picker?.multisigs ?? [])
    .filter((view) => view.record.networkId === status.networkId)
    .map((view) => ({
      address: view.record.address,
      id: view.record.id,
      kind: "multisig",
      name: view.record.name ?? "Multisig",
    }));
  return [...accounts, ...shared];
};

const connectChoiceList = (choices: readonly ConnectChoice[], selectedId: string): string =>
  choices
    .map(
      (choice) =>
        `<button class="request-account-choice" type="button" data-connect-choice="${escapeHtml(choice.id)}" data-connect-kind="${choice.kind}" aria-pressed="${choice.id === selectedId}"><strong>${escapeHtml(choice.name)}</strong><code>${escapeHtml(accountLabel(choice.address))}</code></button>`,
    )
    .join("");

/**
 * Renders a connection request. The approve control carries the account id the
 * user is sharing, so a later switch cannot approve a different account.
 */
export const connectCard = (
  approval: PendingApproval,
  status: WalletStatus,
  preferences: WalletPreferences | null,
  picker?: ConnectPicker,
): string => {
  const choices = connectChoices(status, preferences, picker);
  const presentedId = picker?.selectedMultisigId ?? status.activeAccountId;
  const selected = presentedId ? choices.find((choice) => choice.id === presentedId) : undefined;
  const accountId = selected?.id ?? null;
  const identity =
    choices.length > 1 && selected
      ? `<div class="request-account-choices">${connectChoiceList(choices, selected.id)}</div><dl class="request-detail"><div><dt>Network</dt><dd>${escapeHtml(status.network)}</dd></div></dl>`
      : connectIdentity(status, preferences);
  return `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Connection request")}
      ${status.locked ? '<p class="hint">Unlock the wallet to approve this site.</p>' : ""}
      ${identity}
      ${reviewOutcome(
        approval.existingGrant
          ? "Adds this account to the ones already shared with this site, until you disconnect it."
          : "Shares this account's address with this site until you disconnect it.",
      )}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${reviewConstraints("No transaction is signed and no network fee is charged.")}
    ${decisionRow(
      approval,
      "Connect account",
      status.locked || accountId === null,
      undefined,
      accountId === null ? {} : { "data-approval-account": accountId },
      "Cancel",
    )}
  </li>`;
};
