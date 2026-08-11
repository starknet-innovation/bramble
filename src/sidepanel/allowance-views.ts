/**
 * Allowance-manager flow screen: lists every outstanding ERC20 spending
 * allowance for the active account — the approvals this wallet granted, the
 * ones a multisig it signs for granted, and the ones discovered on-chain for
 * tracked tokens — each revokable one with a one-tap revoke. Every entry is
 * labelled with where it came from, so the origin of each is clear.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { type AllowanceView, isUnlimitedAllowance } from "../starknet/allowance-discovery";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState } from "../ui/content";
import { button } from "../ui/controls";
import { accountLabel, flowHeader, flowScreen } from "./parts";
import { compactAmount } from "./token-row";

// A record the wallet can only bound from below (an increase applied on top of
// a grant it never saw) is labelled as such rather than printed as if it were
// the standing allowance — the understatement is the one direction that hides a
// drainer. An unlimited lower bound is still unlimited, so that label wins.
const amountLabel = (allowance: AllowanceView): string =>
  isUnlimitedAllowance(allowance.amount)
    ? "Unlimited"
    : allowance.lowerBound
      ? `at least ${compactAmount(allowance.amount)}`
      : compactAmount(allowance.amount);

const SOURCE_LABELS: Readonly<Record<AllowanceView["source"], string>> = {
  external: "on-chain",
  multisig: "granted by a multisig you sign for",
  wallet: "this wallet",
};

// One allowance per row: the spender leads (it is who can move funds), with
// the token, amount, and provenance as one quiet supporting line — never three
// stacked label/value pairs fighting for attention. A multisig's allowance is
// listed but carries no revoke control: zeroing it takes a proposal the
// multisig's own quorum executes, so offering the button here would be an
// affordance that can only fail.
const allowanceRow = (allowance: AllowanceView): string => `
  <li class="allowance-row">
    <div class="allowance-copy">
      <code>${escapeHtml(accountLabel(allowance.spender))}</code>
      <p class="hint">${escapeHtml(amountLabel(allowance))} of ${escapeHtml(accountLabel(allowance.token))} · ${escapeHtml(SOURCE_LABELS[allowance.source])}</p>
    </div>
    ${
      allowance.source === "multisig"
        ? ""
        : button({
            attributes: { "data-revoke-allowance": allowance.id },
            label: "Revoke",
            size: "small",
            tone: "danger",
            variant: "ghost",
          })
    }
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
  // Defence in depth behind the background's own scoping: an entry must be on
  // the displayed network and either belong to the active account or be one the
  // background authorized as a multisig this account signs for.
  const scoped = allowances.filter(
    (allowance) =>
      allowance.networkId === status.networkId &&
      (allowance.accountId === account?.id || allowance.source === "multisig"),
  );
  return (
    flowHeader("Allowances", status, `${scoped.length} outstanding`) +
    flowScreen(
      "allowances",
      `<section class="section">
        <p class="hint">Outstanding ERC-20 token approvals for this account: those you granted here plus any discovered on-chain. Revoking sets the spender's allowance to zero. An amount shown as "at least" is one this wallet could only bound from below, because part of the allowance was granted elsewhere. NFT collection approvals are not token allowances and are not listed here — revoke those from the marketplace that asked for them.</p>
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
