/**
 * Allowance-manager flow screen: lists every outstanding ERC20 spending
 * allowance for the active account — the approvals this wallet granted, the
 * ones a multisig it signs for granted, and the ones discovered on-chain for
 * tracked tokens — each revokable one with a one-tap revoke. Every entry is
 * labelled with where it came from, so the origin of each is clear.
 */

import { escapeHtml } from "@bramble/core/html";
import {
  type AllowanceView,
  isUnlimitedAllowance,
} from "@bramble/transactions/allowance-discovery";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import { accountLabel, contextHelp, flowHeader, flowScreen } from "../../shared/parts";
import { compactAmount } from "./token-row";

// A record the wallet can only bound from below (an increase applied on top of
// a grant it never saw) is labelled as such rather than printed as if it were
// the standing allowance — the understatement is the one direction that hides a
// drainer. An unlimited lower bound is still unlimited, so that label wins, and
// a bound of zero bounds nothing at all: the pair is approved for an amount
// this wallet cannot state, which "at least 0" would read as harmless.
const amountLabel = (allowance: AllowanceView): string =>
  isUnlimitedAllowance(allowance.amount)
    ? "Unlimited"
    : !allowance.lowerBound
      ? compactAmount(allowance.amount)
      : allowance.amount === "0"
        ? "an unknown amount"
        : `at least ${compactAmount(allowance.amount)}`;

// A contract the wallet cannot call a token: an ERC721 `approve(to, item_id)`
// is the same three felts as an ERC20 `approve(spender, amount)`, so the figure
// above may be an item id. The revoke control is withheld with it — sending
// `approve(spender, 0)` at a collection approves item #0 rather than revoking —
// and the background refuses that broadcast too.
const UNCONFIRMED_TOKEN_NOTE =
  "This wallet cannot confirm this contract is a token, so the value may be an NFT item id rather than an amount. Revoke it from the site that asked for it.";

const SOURCE_LABELS: Readonly<Record<AllowanceView["source"], string>> = {
  external: "on-chain",
  multisig: "granted by a multisig you sign for",
  wallet: "this wallet",
};

// One allowance per row: the spender leads (it is who can move funds), with
// the token, amount, and provenance as one quiet supporting line — never three
// stacked label/value pairs fighting for attention. A multisig's allowance is
// listed but carries no revoke control: zeroing it takes a separately reviewed
// multisig intent and threshold authorization, so offering the button here would be an
// affordance that can only fail. An unconfirmed contract is withheld the
// control for the opposite reason: the call would not fail, it would grant.
const allowanceRow = (allowance: AllowanceView): string => `
  <li class="allowance-row">
    <div class="allowance-copy">
      <code>${escapeHtml(accountLabel(allowance.spender))}</code>
      <p class="hint">${escapeHtml(amountLabel(allowance))} of ${escapeHtml(accountLabel(allowance.token))} · ${escapeHtml(SOURCE_LABELS[allowance.source])}</p>
      ${allowance.unconfirmedToken ? `<p class="hint">${escapeHtml(UNCONFIRMED_TOKEN_NOTE)}</p>` : ""}
      <p class="allowance-review" data-allowance-review-for="${escapeHtml(allowance.id)}" role="status" hidden></p>
    </div>
    ${
      allowance.source === "multisig" || allowance.unconfirmedToken
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
        <div class="section-head">
          <p class="lede">Revoking sets a spender's allowance to zero after you confirm its network fee.</p>
          ${iconButton({ attributes: { id: "allowance-refresh" }, icon: "refresh", label: "Refresh allowances" })}
        </div>
        ${contextHelp(
          "allowance-scan-scope",
          "What this list includes",
          "It includes approvals granted here and approvals discovered on-chain for tracked ERC-20 tokens. 'At least' means the wallet can only prove a lower bound. NFT approvals and untracked tokens are outside this scan; unconfirmed contracts keep no revoke control because an ERC-20 revoke call could grant an NFT instead.",
        )}
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
