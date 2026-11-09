/**
 * The Shadow accounts screen (issue 443, PR 5): a static shell the bindings fill
 * from the encrypted-vault records. It shows no network data until the user
 * asks, and says why before any control that reads it.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import type { WalletStatus } from "../../../popup/responses/responses";
import { flowHeader, flowScreen } from "../../shared/parts";
import {
  SHADOW_ACCOUNTS_LOADING,
  SHADOW_ACCOUNTS_READ_REASON,
  SHADOW_ACCOUNTS_TITLE,
} from "./shadow-accounts-copy";

/** Renders the screen shell; `bindShadowAccounts` loads and fills the list. */
export const shadowAccountsFlow = (status: WalletStatus): string =>
  flowHeader(SHADOW_ACCOUNTS_TITLE, status) +
  flowScreen(
    "shadow-accounts",
    `<section class="section">
      <p class="lede">${escapeHtml(SHADOW_ACCOUNTS_READ_REASON)}</p>
      <div id="shadow-accounts-list">${emptyState(SHADOW_ACCOUNTS_LOADING)}</div>
      <p id="shadow-accounts-result" role="status"></p>
    </section>`,
  );
