/**
 * Home notice for a Ready account restored by a release whose Krusty derived
 * a different key than Argent X for its phrase. The vault still signs for it,
 * but restoring the phrase again will not find it, so the user backs up its
 * key or moves its funds while this install still holds the key.
 */
import { icon } from "../../shared/icons";

/** The notice, or nothing when the account is not affected. */
export const readyKeyNotice = (affected: boolean): string =>
  affected
    ? `<div class="ready-key-notice" data-ready-key-notice>
      <p class="hero-stale">${icon("alert")}<span>Back up this account's key</span></p>
      <p class="read-only-detail">Restoring your phrase won't find this account. Keep its private key, or move its funds to another account.</p>
      <button class="button button-secondary" type="button" data-view="reveal">Back up key</button>
    </div>`
    : "";
