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
  shadowAccountsLoading,
  shadowAccountsReadReason,
  shadowAccountsTitle,
} from "./shadow-accounts-copy";

/** Renders the screen shell; `bindShadowAccounts` loads and fills the list. */
export const shadowAccountsFlow = (status: WalletStatus): string =>
  flowHeader(shadowAccountsTitle(), status) +
  flowScreen(
    "shadow-accounts",
    `<section class="section">
      <p class="lede">${escapeHtml(shadowAccountsReadReason())}</p>
      <div id="shadow-accounts-list">${emptyState(shadowAccountsLoading())}</div>
      <p id="shadow-accounts-result" role="status"></p>
    </section>`,
  );
