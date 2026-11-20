/**
 * avnu catalog screen template: the verified token list avnu publishes for the
 * active network, each entry offering the action that moves it — add it to the
 * tracked registry, or hide/show one already tracked.
 *
 * The catalog is a directory, never a source of truth. Adding an entry routes
 * through the same add-token path as "Add by contract", which reads the token's
 * name, symbol and decimals from the CONTRACT on chain, so a wrong or hostile
 * list entry cannot put false facts in the wallet. Pure template — the rows are
 * filled by ./token-catalog-ui.ts once the list arrives.
 */

import { escapeHtml } from "@bramble/core/html";
import { inputControl } from "@bramble/ui-kit/fields";
import { t, th } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { flowHeader, flowScreen } from "../../shared/parts";

/** Copy shown while the list is being fetched, in the active language. */
export const catalogLoadingText = (): string => t("portfolio.catalog.loading");

/**
 * Copy for a network avnu publishes no catalog for — devnet, and a Sepolia list
 * that comes back empty. The screen stays reachable everywhere so the Tokens
 * screen does not change shape per network; it says so here instead, and points
 * at the path that always works.
 */
export const catalogEmptyText = (): string => t("portfolio.catalog.empty");

/**
 * Renders the avnu catalog screen: a search field over the list and the rows
 * themselves, which arrive asynchronously.
 */
export const tokenCatalogFlow = (status: WalletStatus): string =>
  flowHeader(t("portfolio.catalog.title"), status, t("portfolio.catalog.subtitle")) +
  flowScreen(
    "token-catalog",
    `<section class="section">
      <label class="send-search">
        <span>${th("portfolio.activity.search")}</span>
        <span class="send-search-control">${icon("search")}${inputControl({
          ariaLabel: t("portfolio.catalog.searchLabel"),
          attributes: { id: "token-catalog-search" },
          autocomplete: "off",
          placeholder: t("portfolio.catalog.searchPlaceholder"),
          spellcheck: false,
          type: "search",
        })}</span>
      </label>
      <p class="hint">${th("portfolio.catalog.hint")}</p>
      <div id="token-catalog-results"></div>
      <p id="token-catalog-result" class="hint" role="status">${escapeHtml(catalogLoadingText())}</p>
    </section>`,
  );
