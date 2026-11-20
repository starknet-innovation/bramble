/**
 * The action row under one NFT gallery card. A discovered-only card (found by
 * the indexer, never chosen by the user) offers "Show art" and "Hide"; a
 * watched card offers "Hide" and "Remove". Split from nft-views to keep both
 * files within the repository size budget.
 *
 * Trust boundary: a discovered-only card carries its identifiers as data-*
 * targets for nft-ui, which hands them to the background's watch path. The
 * background re-validates them and re-proves ownership on chain before storing
 * anything, so a tampered attribute cannot add an NFT the account does not own.
 */

import { button } from "@bramble/ui-kit/controls";
import { t } from "../../../i18n/messages";

/**
 * The fields of a gallery item the action row reads. Structural, so the
 * gallery's item type satisfies it without this module importing the views.
 */
export type NftCardTarget = {
  readonly contract: string;
  readonly id: string;
  readonly networkId: string;
  readonly title: string;
  readonly tokenId: string;
  readonly watched: boolean;
};

const SMALL_SECONDARY = { size: "small", variant: "secondary" } as const;

// "Show art" watches a discovered-only NFT, which is what lets the background
// read its metadata and artwork. Nothing about it is fetched before this click:
// sender-controlled URLs stay uncontacted until the user chooses the NFT.
const showArtButton = (item: NftCardTarget): string =>
  button({
    ...SMALL_SECONDARY,
    attributes: {
      "data-nft-show": item.id,
      "data-nft-show-contract": item.contract,
      "data-nft-show-name": item.title,
      "data-nft-show-network": item.networkId,
      "data-nft-show-token": item.tokenId,
    },
    label: t("collectibles.showArt"),
  });

// The Hide control: a watched entry toggles its stored spam flag; a
// discovered-only entry is persisted-as-spam by nft-ui using the data-* target.
const hideButton = (item: NftCardTarget): string =>
  item.watched
    ? button({
        ...SMALL_SECONDARY,
        attributes: { "data-nft-spam": item.id, "data-nft-spam-value": "true" },
        label: t("collectibles.hide"),
      })
    : button({
        ...SMALL_SECONDARY,
        attributes: {
          "data-nft-hide": item.id,
          "data-nft-hide-contract": item.contract,
          "data-nft-hide-name": item.title,
          "data-nft-hide-network": item.networkId,
          "data-nft-hide-token": item.tokenId,
        },
        label: t("collectibles.hide"),
      });

const removeButton = (item: NftCardTarget): string =>
  button({
    ...SMALL_SECONDARY,
    attributes: { "data-remove-nft": item.id },
    label: t("collectibles.remove"),
    tone: "danger",
  });

/**
 * Renders a card's action row with its buttons in display order. Every dynamic
 * value is escaped by the UI Kit button; the row never loads anything itself.
 * The discovered row sizes its columns to their labels so "Show art" stays on
 * one line in a narrow panel.
 */
export const nftCardActions = (item: NftCardTarget): string =>
  item.watched
    ? `<div class="nft-actions">${hideButton(item)}${removeButton(item)}</div>`
    : `<div class="nft-actions nft-actions--discovered">${showArtButton(item)}${hideButton(item)}</div>`;
