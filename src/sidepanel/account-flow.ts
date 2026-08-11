/**
 * The "Accounts & groups" management screen. Split from ./flows for the
 * file-size budget: this is the largest single flow in that module and its own
 * concern — picking, restoring, organising, and inspecting accounts — while
 * ./flows keeps the dispatcher and the smaller screens.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { knownAccountType } from "../starknet/account-types";
import type { ClassHashVerification } from "../starknet/class-hash-verify";
import type { MultisigRecord } from "../storage/multisig-store";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { receipt } from "../ui/content";
import { button } from "../ui/controls";
import { textField } from "../ui/fields";
import { menuRow } from "../ui/navigation";
import { accountGroupsLine } from "./group-controls";
import { groupsSection } from "./group-members";
import { icon } from "./icons";
import { multisigAccountOptions } from "./multisig-account-options";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  noAccountEmpty,
} from "./parts";

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

/**
 * Manage accounts & groups flow: the single management surface reached from the
 * drawer's "Manage accounts & groups" entry and the Settings menu. Switch the
 * active account, add one, manage groups (create/rename/change-icon/delete plus
 * bulk assignment) in the Groups accordion, name the account, and inspect
 * identifiers. `expandedGroupId` selects the one open Groups panel — a group's
 * bulk members editor or the "Create a group" panel (null = all collapsed).
 */
export const accountFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  expandedGroupId: string | null = null,
  classHashVerification: ClassHashVerification | null = null,
  multisigs: readonly MultisigRecord[] = [],
  selectedMultisigId: string | null = null,
): string => {
  const networkAccounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const networkMultisigs = multisigs.filter((stored) => stored.networkId === status.networkId);
  const accountType = account ? knownAccountType(account.classHash) : null;
  const groups = preferences?.groups ?? [];
  // One grouped picker owns the whole "which account" task: every account row,
  // then "Add account" as the group's terminal action — not a separate boxed
  // section. The active account's editable name and its identifiers follow as
  // one receipt, truncated with copy controls, so the screen reads top to
  // bottom: pick → organise → inspect.
  return (
    flowHeader("Accounts & groups", status, `On ${status.network}`) +
    flowScreen(
      "account",
      `<section class="section">
        <p class="eyebrow">Accounts</p>
        <div class="option-list" role="group" aria-label="Accounts">
          ${networkAccounts
            .map((stored) => {
              const memberGroups = groups.filter((group) => group.accountIds.includes(stored.id));
              const selected = selectedMultisigId === null && stored.id === account?.id;
              return `<button class="option-row" data-account-id="${escapeHtml(stored.id)}" type="button" aria-pressed="${selected}">
                    <span class="option-avatar">${accountAvatar(stored.address)}</span>
                    <span class="option-copy">
                      <strong>${escapeHtml(accountDisplayName(stored, preferences))}</strong>
                      <code>${accountLabel(stored.address)}</code>
                      ${accountGroupsLine(memberGroups)}
                    </span>
                    ${selected ? `<span class="option-mark">${icon("check")}</span>` : ""}
                  </button>`;
            })
            .join("")}
          ${multisigAccountOptions(networkMultisigs, selectedMultisigId)}
          ${menuRow({
            attributes: {
              id: "new-account",
              title: `Derives the next account on ${status.network} from this wallet's recovery phrase.`,
            },
            className: "row-action",
            icon: "plus",
            label: "Add account",
          })}
          ${menuRow({
            attributes: {
              id: "restore-accounts",
              title: `Looks for accounts on ${status.network} that this wallet's recovery phrase already has, and adds any that are missing.`,
            },
            className: "row-action",
            icon: "refresh",
            label: "Find my other accounts",
          })}
        </div>
        ${networkAccounts.length === 0 && networkMultisigs.length === 0 ? noAccountEmpty(status) : ""}
        <p id="picker-result" role="status"></p>
        <p id="new-account-result" role="status"></p>
      </section>
      ${groupsSection(groups, status.accounts, preferences, expandedGroupId, status.networks)}
      ${
        account
          ? `<section class="section">
              <p class="eyebrow">${selectedMultisigId === null ? "Active account" : "Current signer"}</p>
              <form id="label-form">
                ${textField({
                  autocomplete: "off",
                  hint: "Shown instead of the address. Leave empty to clear.",
                  label: "Name",
                  maxlength: 64,
                  name: "label",
                  placeholder: accountLabel(account.address),
                  value: preferences?.accountLabels?.[account.id] ?? "",
                })}
                ${button({
                  icon: "check",
                  label: "Save name",
                  type: "submit",
                  variant: "secondary",
                })}
                <p id="label-result" role="status"></p>
              </form>
              ${receipt([
                {
                  action: {
                    attributes: { "data-copy": account.address },
                    icon: "copy",
                    label: "Copy address",
                  },
                  label: "Address",
                  value: accountLabel(account.address),
                  valueStyle: "code",
                },
                {
                  action: {
                    attributes: { "data-copy": account.classHash },
                    icon: "copy",
                    label: "Copy class hash",
                  },
                  label: "Class hash",
                  value: accountLabel(account.classHash),
                  valueStyle: "code",
                },
                ...(accountType ? [{ label: "Type", value: accountType }] : []),
              ])}
              ${classHashVerificationBadge(classHashVerification)}
            </section>`
          : ""
      }`,
    )
  );
};
