/**
 * Withdrawal-destination surface for the unshield direction. Unshielding is the
 * one privacy operation whose destination is public on-chain, so the flow names
 * the account that will be linked to the withdrawal instead of leaving an empty
 * address box: the active account by default, any other owned account behind a
 * switch, or a freshly derived account for a withdrawal that links to nothing
 * the user has used before. Pure view + resolution; bindings live in
 * ./privacy-destination-ui.
 */

import { escapeHtml } from "../shared/html";
import { sameFelt } from "../starknet/networks";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { inputControl } from "../ui/fields";
import { icon } from "./icons";
import { accountAvatar, accountDisplayName, accountLabel } from "./parts";

/**
 * The account a withdrawal will land in, resolved from the journey's selection.
 * `account` is null only when the wallet holds no account on this network.
 */
export type WithdrawDestination = {
  readonly account: AccountRef | null;
  /** Whether this is the wallet's currently active account. */
  readonly isActive: boolean;
};

/**
 * Accounts eligible as a withdrawal destination: every owned account on the
 * active network. Ledger accounts are included — a withdrawal is a public
 * transfer to an address, so the destination never has to authorize anything.
 */
export const withdrawDestinationChoices = (
  accounts: readonly AccountRef[],
  networkId: string,
): readonly AccountRef[] => accounts.filter((account) => account.networkId === networkId);

/**
 * Resolves the selected destination, falling back to the active account when
 * nothing is selected or the selection has disappeared (e.g. a network switch).
 */
export const resolveWithdrawDestination = (input: {
  readonly accounts: readonly AccountRef[];
  readonly activeAccountId: string | null;
  readonly networkId: string;
  readonly selectedAccountId: string | undefined;
}): WithdrawDestination => {
  const choices = withdrawDestinationChoices(input.accounts, input.networkId);
  const active = choices.find((account) => account.id === input.activeAccountId) ?? null;
  const selected = input.selectedAccountId
    ? (choices.find((account) => account.id === input.selectedAccountId) ?? null)
    : null;
  const account = selected ?? active ?? choices[0] ?? null;
  return { account, isActive: account !== null && account.id === active?.id };
};

/**
 * Resolves the address a withdrawal should be sent to. A typed address always
 * wins — the destination need not be an owned account — and is trimmed but not
 * validated here; the background rejects a malformed one.
 */
export const withdrawDestinationAddress = (
  typed: string,
  destination: WithdrawDestination,
): string | undefined => typed.trim() || destination.account?.address;

const identity = (account: AccountRef, preferences: WalletPreferences | null): string => `
  <span class="privacy-destination-avatar" aria-hidden="true">${accountAvatar(account.address)}</span>
  <span class="privacy-destination-copy">
    <strong>${escapeHtml(accountDisplayName(account, preferences))}</strong>
    <code>${escapeHtml(accountLabel(account.address))}</code>
  </span>`;

const option = (
  account: AccountRef,
  preferences: WalletPreferences | null,
  selected: boolean,
): string => `
  <button class="privacy-destination-option" data-privacy-destination-pick="${escapeHtml(account.id)}" type="button" aria-pressed="${selected}">
    ${identity(account, preferences)}
    ${selected ? `<span class="privacy-destination-mark">${icon("check")}</span>` : ""}
  </button>`;

/**
 * Renders the destination block shown while unshielding. Hidden by the caller
 * in the shield direction, where the destination is the user's own shielded
 * balance and nothing becomes public.
 */
export const withdrawDestinationView = (input: {
  readonly accounts: readonly AccountRef[];
  readonly activeAccountId: string | null;
  readonly networkId: string;
  readonly preferences: WalletPreferences | null;
  readonly selectedAccountId: string | undefined;
}): string => {
  const choices = withdrawDestinationChoices(input.accounts, input.networkId);
  const destination = resolveWithdrawDestination(input);
  const current = destination.account
    ? `<div class="privacy-destination-current">
        ${identity(destination.account, input.preferences)}
        ${destination.isActive ? '<span class="privacy-destination-badge">This account</span>' : ""}
        <button class="privacy-destination-pill" data-privacy-destination-toggle type="button" aria-expanded="false">Switch</button>
      </div>`
    : '<p class="hint">Add an account on this network to withdraw into.</p>';
  return `<div class="privacy-destination" data-privacy-recipient-row hidden>
      <span class="privacy-destination-label">Withdraw to</span>
      ${current}
      <div class="privacy-destination-options" data-privacy-destination-options hidden>
        ${choices.map((account) => option(account, input.preferences, account.id === destination.account?.id)).join("")}
        <button class="privacy-destination-new" data-privacy-destination-new type="button">
          <span class="privacy-destination-new-mark" aria-hidden="true">${icon("plus")}</span>
          <span class="privacy-destination-copy">
            <strong>Withdraw to a fresh account</strong>
            <span>A brand-new address links this withdrawal to nothing else you own.</span>
          </span>
        </button>
        <label class="privacy-destination-manual">
          <span>Or withdraw to any address</span>
          ${inputControl({
            ariaLabel: "Public address to withdraw to",
            attributes: { id: "privacy-withdraw-recipient" },
            autocomplete: "off",
            className: "mono",
            name: "withdrawRecipient",
            placeholder: "0x…",
            spellcheck: false,
          })}
        </label>
      </div>
    </div>`;
};

/**
 * Names an already-prepared withdrawal's destination on the review screen: the
 * owned account it lands in, or the bare address when it leaves the wallet.
 */
export const withdrawDestinationReceipt = (input: {
  readonly accounts: readonly AccountRef[];
  readonly preferences: WalletPreferences | null;
  readonly recipient: string;
}): string => {
  const owned = input.accounts.find((account) => sameFelt(account.address, input.recipient));
  return owned
    ? `${escapeHtml(accountDisplayName(owned, input.preferences))} · ${escapeHtml(accountLabel(owned.address))}`
    : escapeHtml(accountLabel(input.recipient));
};
