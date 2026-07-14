/**
 * Allowance-manager flow screen: lists every outstanding ERC20 spending
 * allowance for the active account — both the approvals this wallet granted and
 * the ones discovered on-chain for tracked tokens — each with a one-tap revoke.
 * Externally granted allowances are labelled so the origin of each entry is
 * clear.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { type AllowanceView, isUnlimitedAllowance } from "../starknet/allowance-discovery";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";
import { accountLabel, flowHeader, flowScreen } from "./parts";

const amountLabel = (amount: string): string =>
  isUnlimitedAllowance(amount) ? "Unlimited" : amount;

const sourceLabel = (source: AllowanceView["source"]): string =>
  source === "external" ? "On-chain" : "This wallet";

const allowanceRow = (allowance: AllowanceView): string => `
  <li class="allowance-row">
    <div class="allowance-copy">
      <p class="eyebrow">Spender · ${escapeHtml(sourceLabel(allowance.source))}</p>
      <code>${escapeHtml(accountLabel(allowance.spender))}</code>
      <p class="hint">Token ${escapeHtml(accountLabel(allowance.token))} · Amount ${escapeHtml(amountLabel(allowance.amount))}</p>
    </div>
    <button class="secondary small danger" data-revoke-allowance="${escapeHtml(allowance.id)}" type="button">${icon("x")}Revoke</button>
  </li>`;

/**
 * Allowance flow: review and revoke every outstanding approval for the active
 * network, whether granted through this wallet or discovered on-chain.
 */
export const allowancesFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  allowances: readonly AllowanceView[],
): string => {
  const scoped = allowances.filter(
    (allowance) => allowance.networkId === status.networkId && allowance.accountId === account?.id,
  );
  return (
    flowHeader("Allowances", "settings", status, `${scoped.length} outstanding`) +
    flowScreen(
      "allowances",
      `<section class="section">
        <p class="hint">Outstanding token approvals for this account: those you granted here plus any discovered on-chain for the tokens you track. Revoking sets the spender's allowance to zero. Approvals on tokens you don't track may not appear.</p>
        ${
          account === null
            ? '<p class="empty">Unlock an account on this network to manage allowances.</p>'
            : scoped.length === 0
              ? '<p class="empty">No outstanding allowances found for this account. Approvals on tokens you don\'t track are not scanned.</p>'
              : `<ul class="allowance-list">${scoped.map(allowanceRow).join("")}</ul>`
        }
        <p id="allowance-result" role="status"></p>
      </section>`,
    )
  );
};
