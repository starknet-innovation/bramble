/**
 * Home notice for a Ready account restored by a release whose Krusty derived
 * a different key than Argent X for its phrase. The vault still signs for it,
 * but restoring the phrase again will not find it, so the user moves its funds
 * or backs up its key while this install still holds the key.
 */
import { escapeHtml } from "@bramble/core/html";
import { th } from "../../../i18n/messages";
import { icon } from "../../shared/icons";

/** What the notice needs to know about the active account. */
export type ReadyKeyNoticeInput = {
  /** The active account, named on the dismiss control so a switch cannot redirect it. */
  readonly accountId: string;
  /** Whether the account's key predates Krusty 3.0's Argent X fix. */
  readonly affected: boolean;
  /** Whether the user dismissed this account's notice. */
  readonly dismissed: boolean;
  /** Whether Send is open to this account; a read-only account offers only the backup. */
  readonly canMoveFunds: boolean;
};

/**
 * The notice, or nothing when the account is not affected or its notice was
 * dismissed. "Move funds" opens Send and "Back up key" opens the reveal flow,
 * both for the active account.
 */
export const readyKeyNotice = (input: ReadyKeyNoticeInput): string =>
  input.affected && !input.dismissed
    ? `<div class="ready-key-notice" data-ready-key-notice>
      <p class="hero-stale">${icon("alert")}<span>${th("portfolio.readyKey.title")}</span></p>
      <p class="read-only-detail">${th("portfolio.readyKey.body")}</p>
      <div class="ready-key-notice-actions">
        ${input.canMoveFunds ? `<button type="button" data-view="send">${th("portfolio.readyKey.moveFunds")}</button>` : ""}
        <button class="secondary" type="button" data-view="reveal">${th("portfolio.readyKey.backUp")}</button>
      </div>
      <button class="ghost" id="ready-key-notice-hide" type="button" data-account-id="${escapeHtml(input.accountId)}">${th("portfolio.readyKey.hide")}</button>
    </div>`
    : "";
