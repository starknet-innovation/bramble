/**
 * NFT gallery and detail flow screens. The gallery auto-lists the NFTs the
 * active account owns — discovered through the configured indexer and re-proven
 * on-chain in the background — merged with any manually watched collectibles,
 * hides spam behind a toggle, and keeps the manual "Watch a collectible" form for
 * tokens auto-discovery does not surface. Each entry renders a collection/token-id
 * caption; its remote image loads immediately only for solicited (manually
 * watched) NFTs, while unsolicited auto-discovered ones show a placeholder until
 * the user opens them — so an airdropped tile cannot phone home on gallery paint.
 * Detail sends through the verified invoke path.
 */

import { escapeHtml } from "@bramble/core/html";
import type { NftAttribute } from "@bramble/portfolio/nft-metadata";
import type { WatchedNft } from "@bramble/portfolio/watched-nft";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState, receipt } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { DiscoveredNft, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import {
  accountLabel,
  flowHeader,
  flowScreen,
  inlineCopyButton,
  noAccountEmpty,
  walletMenuRow,
} from "../../shared/parts";

/**
 * One display-safe collectible normalized from discovery metadata or a saved
 * watch. Unresolved fields stay empty and `watched` identifies user-solicited
 * images that wallet surfaces may load without weakening the privacy boundary.
 */
export type NftGalleryItem = {
  readonly animationUrl: string;
  readonly attributes: readonly NftAttribute[];
  readonly collection: string;
  readonly contract: string;
  readonly description: string;
  readonly id: string;
  readonly image: string;
  readonly networkId: string;
  readonly pixelated: boolean;
  readonly title: string;
  readonly tokenId: string;
  readonly watched: boolean;
};

const watchedTitle = (nft: WatchedNft): string => nft.label ?? `NFT #${nft.tokenId}`;

const discoveredTitle = (nft: DiscoveredNft, watched: WatchedNft | undefined): string =>
  nft.name.length > 0 ? nft.name : (watched?.label ?? `NFT #${nft.tokenId}`);

const usesPixelArtwork = (attributes: readonly NftAttribute[]): boolean =>
  attributes.some(
    (attribute) =>
      attribute.traitType.toLowerCase() === "catalog" &&
      attribute.value.toLowerCase() === "cryptopunks",
  );

// Builds the visible gallery rows for the active network by merging discovered
// NFTs (deduped against watched ones by id) with manually watched NFTs, dropping
// anything hidden as spam. Discovered rows win on collision so their image and
// collection are kept.
/**
 * Merges owned discovery metadata with saved watch entries for one network.
 *
 * Discovery metadata wins on matching ids so every wallet surface uses the
 * same image, title, and collection. Hidden entries are removed and watched
 * entries remain available when metadata resolution fails.
 */
export const visibleNftItems = (
  watched: readonly WatchedNft[],
  discovered: readonly DiscoveredNft[],
  networkId: string,
  ownerAddress?: string | null,
): readonly NftGalleryItem[] => {
  const onNetwork = watched.filter(
    (nft) =>
      nft.networkId === networkId &&
      (ownerAddress === undefined ||
        (ownerAddress !== null && (nft.owner === undefined || sameFelt(nft.owner, ownerAddress)))),
  );
  const watchedById = new Map(onNetwork.map((nft) => [nft.id, nft]));
  const spamIds = new Set(onNetwork.filter((nft) => nft.spam === true).map((nft) => nft.id));
  const items: NftGalleryItem[] = [];
  for (const nft of discovered) {
    if (nft.networkId !== networkId || spamIds.has(nft.id)) {
      continue;
    }
    const attributes = nft.attributes ?? [];
    items.push({
      animationUrl: nft.animationUrl ?? "",
      attributes,
      collection: nft.collection,
      contract: nft.contract,
      description: nft.description ?? "",
      id: nft.id,
      image: nft.image,
      networkId: nft.networkId,
      pixelated: usesPixelArtwork(attributes),
      title: discoveredTitle(nft, watchedById.get(nft.id)),
      tokenId: nft.tokenId,
      watched: watchedById.has(nft.id),
    });
  }
  // Saved preferences are never rendered as ownership evidence. The
  // background must first return the token through its account-scoped,
  // on-chain ownership proof; this prevents one account's saved watch from
  // appearing in every other account while retaining its label/action state.
  return items;
};

// The art tile: the placeholder icon always renders; a present image overlays it
// only when `reveal` is true, and is swapped back out to the placeholder by
// nft-ui when it fails to load. Images are withheld (placeholder only) for
// unsolicited auto-discovered NFTs until the user explicitly opens that NFT, so
// an airdropped tile cannot deanonymize the wallet (address -> IP) merely by the
// gallery painting a remote image element. Solicited (manually watched) NFTs and the
// opened detail view reveal immediately.
/**
 * Renders a resolved NFT image only after the caller has established that the
 * user solicited it. Remote-load failure is handled by the shared NFT binding.
 * `eager` is reserved for the first visible gallery items and the detail hero
 * so those requests begin as the gallery paints rather than after it settles.
 */
export const nftImageMarkup = (item: NftGalleryItem, reveal: boolean, eager = false): string =>
  reveal && item.image
    ? `<img class="nft-image${item.pixelated ? " nft-image--pixelated" : ""}" src="${escapeHtml(item.image)}" alt="" loading="${eager ? "eager" : "lazy"}" referrerpolicy="no-referrer" />`
    : "";

const nftArt = (item: NftGalleryItem, reveal: boolean, eager = false): string =>
  `<span class="nft-art">${nftImageMarkup(item, reveal, eager)}${icon("image")}</span>`;

// The tile play affordance for a collectible with an on-chain animation: a
// button that overlays the art square (revealed on hover/focus) plus the hidden
// sandboxed iframe it drives. Used by the gallery card; nft-ui's `bindAnimation`
// wires the click. It sits outside the tile's open button (no nested buttons)
// and is emitted only for watched, solicited tokens carrying an `animationUrl`,
// so it never runs on gallery paint. The host `<li>` must be positioned
// (`.nft-card`) for the overlay to cover the art.
const nftTilePlay = (item: NftGalleryItem): string =>
  item.animationUrl
    ? `<button class="nft-play-tile" data-nft-play="${escapeHtml(item.animationUrl)}" type="button" aria-label="Play animation">${icon("gamepad")}<span>Play animation</span></button>
      <iframe class="nft-animation nft-animation--tile" title="Collectible animation" sandbox="allow-scripts" referrerpolicy="no-referrer" hidden></iframe>`
    : "";

// The Hide control: a watched entry toggles its stored spam flag; a
// discovered-only entry is persisted-as-spam by nft-ui using the data-* target.
const hideButton = (item: NftGalleryItem): string =>
  item.watched
    ? button({
        attributes: { "data-nft-spam": item.id, "data-nft-spam-value": "true" },
        label: "Hide",
        size: "small",
        variant: "ghost",
      })
    : button({
        attributes: {
          "data-nft-hide": item.id,
          "data-nft-hide-contract": item.contract,
          "data-nft-hide-name": item.title,
          "data-nft-hide-network": item.networkId,
          "data-nft-hide-token": item.tokenId,
        },
        label: "Hide",
        size: "small",
        variant: "ghost",
      });

/**
 * Renders one production gallery card, including privacy-aware art loading and
 * watched/hidden actions.
 */
export const nftGalleryCard = (item: NftGalleryItem, eager: boolean): string => `
  <li class="nft-card">
    <button class="nft-open" data-nft-open="${escapeHtml(item.id)}" type="button">
      ${nftArt(item, item.watched, eager)}
      <span class="nft-copy">
        <strong>${escapeHtml(item.title)}</strong>
        <code>${escapeHtml(item.collection || accountLabel(item.contract))} · #${escapeHtml(item.tokenId)}</code>
      </span>
    </button>
    ${nftTilePlay(item)}
    <div class="nft-actions">
      ${hideButton(item)}
      ${
        item.watched
          ? button({
              attributes: { "data-remove-nft": item.id },
              label: "Remove",
              size: "small",
              tone: "danger",
              variant: "ghost",
            })
          : ""
      }
    </div>
  </li>`;

const hiddenRow = (nft: WatchedNft): string => `
  <li class="address-line">
    <div class="stack-tight">
      <strong>${escapeHtml(watchedTitle(nft))}</strong>
      <span class="copy-line"><code title="${escapeHtml(nft.contract)}">${escapeHtml(accountLabel(nft.contract))} · #${escapeHtml(nft.tokenId)}</code>${inlineCopyButton(nft.contract, "Copy collection contract address")}</span>
    </div>
    ${button({
      attributes: { "data-nft-spam": nft.id, "data-nft-spam-value": "false" },
      icon: "check",
      label: "Unhide",
      size: "small",
      variant: "secondary",
    })}
    ${iconButton({
      attributes: { "data-remove-nft": nft.id },
      icon: "x",
      label: "Remove",
      tone: "danger",
    })}
  </li>`;

const hiddenNftsForAccount = (
  watched: readonly WatchedNft[],
  discovered: readonly DiscoveredNft[],
  networkId: string,
  account: AccountRef | null,
): readonly WatchedNft[] => {
  if (!account) return [];
  const verifiedIds = new Set(discovered.map((nft) => nft.id));
  return watched.filter(
    (nft) =>
      nft.networkId === networkId &&
      nft.spam === true &&
      (nft.owner === undefined ? verifiedIds.has(nft.id) : sameFelt(nft.owner, account.address)),
  );
};

/**
 * NFT gallery flow: an auto-discovered grid of owned collectibles merged with
 * manual watches. Watch and hidden-item management are dedicated screens.
 */
export const nftGalleryFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  discoveredNfts: readonly DiscoveredNft[] = [],
): string => {
  const watched = preferences?.nfts ?? [];
  const visible = visibleNftItems(
    watched,
    discoveredNfts,
    status.networkId,
    account?.address ?? null,
  );
  const hidden = hiddenNftsForAccount(watched, discoveredNfts, status.networkId, account);
  return (
    flowHeader("NFTs", status, `${visible.length} shown`) +
    flowScreen(
      "nfts",
      `<section class="section">
        <div class="menu-list" role="group" aria-label="Collectible actions">
          ${walletMenuRow("nft-watch", "Watch by contract", "plus")}
          ${walletMenuRow("nft-hidden", "Hidden collectibles", "image", String(hidden.length))}
        </div>
      </section>
      <section class="section">
        ${
          visible.length === 0
            ? emptyState(
                "No collectibles found for this account yet. Watch one you own to see it here.",
              )
            : `<ul class="nft-grid">${visible.map((nft, index) => nftGalleryCard(nft, index < 4)).join("")}</ul>`
        }
      </section>`,
    )
  );
};

/**
 * Renders manual NFT watch as an isolated ownership-verification task.
 */
export const nftWatchFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Watch collectible", status, "Add one token you already own") +
  flowScreen(
    "nft-watch",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <form id="nft-form">
        <input name="networkId" type="hidden" value="${escapeHtml(status.networkId)}" />
        ${textField({
          autocomplete: "off",
          className: "mono",
          disabled: account === null,
          label: "Contract",
          name: "contract",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${textField({
          autocomplete: "off",
          className: "mono",
          disabled: account === null,
          inputmode: "numeric",
          label: "Token id",
          name: "tokenId",
          placeholder: "0",
          required: true,
        })}
        ${textField({
          autocomplete: "off",
          disabled: account === null,
          label: "Label (optional)",
          maxlength: 64,
          name: "label",
        })}
        ${button({
          disabled: account === null,
          icon: "check",
          label: "Check and add collectible",
          type: "submit",
        })}
        <p id="nft-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Renders hidden collectible management without crowding the gallery.
 */
export const nftHiddenFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  account: AccountRef | null,
  discoveredNfts: readonly DiscoveredNft[] = [],
): string => {
  const hidden = hiddenNftsForAccount(
    preferences?.nfts ?? [],
    discoveredNfts,
    status.networkId,
    account,
  );
  return (
    flowHeader("Hidden collectibles", status, `${hidden.length} hidden`) +
    flowScreen(
      "nft-hidden",
      `<section class="section">
        <p class="hint">Unhide only tokens you recognize.</p>
        ${
          hidden.length === 0
            ? emptyState("No collectibles are hidden on this network.")
            : `<ul class="address-book">${hidden.map(hiddenRow).join("")}</ul>`
        }
      </section>`,
    )
  );
};

/**
 * Resolves one selected collectible from rich discovery metadata first, using
 * a matching watch only for label and action state. A saved-watch fallback
 * remains usable while discovery is incomplete.
 */
export const selectedNftDetail = (
  preferences: WalletPreferences | null,
  discoveredNfts: readonly DiscoveredNft[],
  selectedNftId: string | null,
  ownerAddress?: string | null,
): NftGalleryItem | null => {
  const watched = (preferences?.nfts ?? []).find(
    (nft) =>
      nft.id === selectedNftId &&
      (ownerAddress === undefined ||
        (ownerAddress !== null && (nft.owner === undefined || sameFelt(nft.owner, ownerAddress)))),
  );
  const discovered = discoveredNfts.find((nft) => nft.id === selectedNftId);
  if (discovered) {
    return {
      animationUrl: discovered.animationUrl ?? "",
      attributes: discovered.attributes ?? [],
      collection: discovered.collection,
      contract: discovered.contract,
      description: discovered.description ?? "",
      id: discovered.id,
      image: discovered.image,
      networkId: discovered.networkId,
      pixelated: usesPixelArtwork(discovered.attributes ?? []),
      title: discoveredTitle(discovered, watched),
      tokenId: discovered.tokenId,
      watched: watched !== undefined,
    };
  }
  return null;
};

// The on-chain animation section: shown only when the resolved metadata carries a
// self-contained data:text/html animation. Nothing renders until the user presses
// play (preserving the anti-phone-home reveal boundary); on click, nft-ui points
// the iframe at the manifest-sandboxed sandbox/render.html page (no privileged
// extension APIs or parent-DOM access, a CSP that blocks fetches and resource
// loads) which renders the untrusted HTML in isolation. The hint does not claim
// "no network access": CSP does not govern WebRTC, and browsers differ on DNS
// prefetching (Sherlock 236). The URI is carried on the button's data-* and
// escaped into it here.
const nftAnimationSection = (item: NftGalleryItem): string =>
  item.animationUrl
    ? `<section class="section">
        <h2>Animation</h2>
        <span class="hint">This collectible draws its own animation. Press play to load it.</span>
        <button class="secondary small" data-nft-play="${escapeHtml(item.animationUrl)}" type="button">${icon("gamepad")}Play animation</button>
        <iframe class="nft-animation" title="Collectible animation" sandbox="allow-scripts" referrerpolicy="no-referrer" hidden></iframe>
      </section>`
    : "";

/**
 * NFT detail flow: artwork, identifiers, and attributes with one explicit
 * entry into the guarded send journey.
 */
export const nftDetailFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  selectedNftId: string | null,
  discoveredNfts: readonly DiscoveredNft[] = [],
): string => {
  const nft = selectedNftDetail(
    preferences,
    discoveredNfts,
    selectedNftId,
    account?.address ?? null,
  );
  return (
    flowHeader("Collectible", status, nft ? nft.title : "") +
    flowScreen(
      "nft-detail",
      nft === null
        ? `<section class="section">${emptyState("This collectible is no longer watched.")}</section>`
        : `<section class="section">
            ${nft.image || nft.collection ? `<div class="nft-hero">${nftArt(nft, true, true)}${nft.collection ? `<p class="eyebrow">${escapeHtml(nft.collection)}</p>` : ""}</div>` : ""}
            ${nft.description ? `<p class="lede">${escapeHtml(nft.description)}</p>` : ""}
            ${receipt([
              {
                action: {
                  attributes: { "data-copy": nft.contract },
                  icon: "copy",
                  label: "Copy contract address",
                },
                label: "Contract",
                value: accountLabel(nft.contract),
                valueStyle: "code",
              },
              { label: "Token id", value: nft.tokenId, valueStyle: "code" },
            ])}
          </section>
          ${
            nft.attributes.length === 0
              ? ""
              : `<section class="section">
                  <h2>Attributes</h2>
                  ${receipt(
                    nft.attributes.map((attribute) => ({
                      label: attribute.traitType,
                      value: attribute.value,
                    })),
                  )}
                </section>`
          }
          ${nftAnimationSection(nft)}
          <section class="section">
            ${account ? "" : noAccountEmpty(status)}
            ${button({
              attributes: { "data-view": "nft-send" },
              disabled: account === null,
              icon: "send",
              label: "Send this collectible",
            })}
          </section>`,
    )
  );
};
