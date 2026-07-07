/**
 * Allowance-manager flow screen: lists the ERC20 spending allowances this
 * wallet granted through approvals, each with a one-tap revoke. On-chain
 * enumeration of externally granted allowances is a documented follow-up, so
 * only approvals submitted through this wallet appear here.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { AllowanceRecord } from "../storage/allowance-store";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";
import { accountLabel, flowHeader, flowScreen } from "./parts";

const UNLIMITED_THRESHOLD = 1n << 128n;

const amountLabel = (amount: string): string => {
  try {
    return BigInt(amount) >= UNLIMITED_THRESHOLD ? "Unlimited" : amount;
  } catch {
    return amount;
  }
};

const allowanceRow = (allowance: AllowanceRecord): string => `
  <li class="allowance-row">
    <div class="allowance-copy">
      <p class="eyebrow">Spender</p>
      <code>${escapeHtml(accountLabel(allowance.spender))}</code>
      <p class="hint">Token ${escapeHtml(accountLabel(allowance.token))} · Amount ${escapeHtml(amountLabel(allowance.amount))}</p>
    </div>
    <button class="secondary small danger" data-revoke-allowance="${escapeHtml(allowance.id)}" type="button">${icon("x")}Revoke</button>
  </li>`;

/**
 * Allowance flow: review and revoke tracked approvals for the active network.
 */
export const allowancesFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  allowances: readonly AllowanceRecord[],
): string => {
  const scoped = allowances.filter(
    (allowance) => allowance.networkId === status.networkId && allowance.accountId === account?.id,
  );
  return (
    flowHeader("Allowances", "settings", status, `${scoped.length} tracked`) +
    flowScreen(
      "allowances",
      `<section class="section">
        <p class="hint">Approvals you granted through this wallet. Revoking sets the spender's allowance to zero. Allowances granted on other sites are not shown yet.</p>
        ${
          account === null
            ? '<p class="empty">Unlock an account on this network to manage allowances.</p>'
            : scoped.length === 0
              ? '<p class="empty">No tracked allowances on this network yet.</p>'
              : `<ul class="allowance-list">${scoped.map(allowanceRow).join("")}</ul>`
        }
        <p id="allowance-result" role="status"></p>
      </section>`,
    )
  );
};
