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
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { flowHeader, flowScreen } from "../../shared/parts";

/** Copy shown while the list is being fetched. */
export const CATALOG_LOADING_TEXT = "Loading the avnu token list…";

/**
 * Copy for a network avnu publishes no catalog for — devnet, and a Sepolia list
 * that comes back empty. The screen stays reachable everywhere so the Tokens
 * screen does not change shape per network; it says so here instead, and points
 * at the path that always works.
 */
export const CATALOG_EMPTY_TEXT =
  "avnu lists no tokens for this network. Add one by contract address instead.";

/**
 * Renders the avnu catalog screen: a search field over the list and the rows
 * themselves, which arrive asynchronously.
 */
export const tokenCatalogFlow = (status: WalletStatus): string =>
  flowHeader("avnu token list", status, "Tokens avnu verifies for this network") +
  flowScreen(
    "token-catalog",
    `<section class="section">
      <label class="send-search">
        <span>Search</span>
        <span class="send-search-control">${icon("search")}${inputControl({
          ariaLabel: "Search the avnu token list by name, symbol, or address",
          attributes: { id: "token-catalog-search" },
          autocomplete: "off",
          placeholder: "Name, symbol, or address",
          spellcheck: false,
          type: "search",
        })}</span>
      </label>
      <p class="hint">Adding a token reads its name, symbol, and decimals from the contract, never from this list.</p>
      <div id="token-catalog-results"></div>
      <p id="token-catalog-result" class="hint" role="status">${escapeHtml(CATALOG_LOADING_TEXT)}</p>
    </section>`,
  );
