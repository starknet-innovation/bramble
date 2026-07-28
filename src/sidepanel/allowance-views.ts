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
import { emptyState } from "../ui/content";
import { button } from "../ui/controls";
import { accountLabel, flowHeader, flowScreen } from "./parts";
import { compactAmount } from "./token-row";

const amountLabel = (amount: string): string =>
  isUnlimitedAllowance(amount) ? "Unlimited" : compactAmount(amount);

const sourceLabel = (source: AllowanceView["source"]): string =>
  source === "external" ? "on-chain" : "this wallet";

// One allowance per row: the spender leads (it is who can move funds), with
// the token, amount, and provenance as one quiet supporting line — never three
// stacked label/value pairs fighting for attention.
const allowanceRow = (allowance: AllowanceView): string => `
  <li class="allowance-row">
    <div class="allowance-copy">
      <code>${escapeHtml(accountLabel(allowance.spender))}</code>
      <p class="hint">${escapeHtml(amountLabel(allowance.amount))} of ${escapeHtml(accountLabel(allowance.token))} · ${escapeHtml(sourceLabel(allowance.source))}</p>
    </div>
    ${button({
      attributes: { "data-revoke-allowance": allowance.id },
      label: "Revoke",
      size: "small",
      tone: "danger",
      variant: "ghost",
    })}
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
    flowHeader("Allowances", status, `${scoped.length} outstanding`) +
    flowScreen(
      "allowances",
      `<section class="section">
        <p class="hint">Outstanding token approvals for this account: those you granted here plus any discovered on-chain for the tokens you track. Revoking sets the spender's allowance to zero. Approvals on tokens you don't track may not appear.</p>
        ${
          account === null
            ? emptyState("Unlock an account on this network to manage allowances.")
            : scoped.length === 0
              ? emptyState(
                  "No outstanding allowances found for this account. Approvals on tokens you don't track are not scanned.",
                )
              : `<ul class="allowance-list">${scoped.map(allowanceRow).join("")}</ul>`
        }
        <p id="allowance-result" role="status"></p>
      </section>`,
    )
  );
};
