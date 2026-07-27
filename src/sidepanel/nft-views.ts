/**
 * NFT gallery and detail flow screens. The gallery auto-lists the NFTs the
 * active account owns — discovered through the configured indexer and re-proven
 * on-chain in the background — merged with any manually watched collectibles,
 * hides spam behind a toggle, and keeps the manual "Watch an NFT" form for
 * tokens auto-discovery does not surface. Each entry renders a collection/token-id
 * caption; its remote image loads immediately only for solicited (manually
 * watched) NFTs, while unsolicited auto-discovered ones show a placeholder until
 * the user opens them — so an airdropped tile cannot phone home on gallery paint.
 * Detail sends through the verified invoke path.
 */
import type { DiscoveredNft, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { NftAttribute } from "../starknet/nft-metadata";
import type { WatchedNft } from "../storage/nft";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState, receipt } from "../ui/content";
import { button, iconButton } from "../ui/controls";
import { textField } from "../ui/fields";
import { icon } from "./icons";
import { accountLabel, flowHeader, flowScreen, noAccountEmpty } from "./parts";

/**
 * One display-safe collectible normalized from discovery metadata or a saved
 * watch. Unresolved fields stay empty and `watched` identifies user-solicited
 * images that wallet surfaces may load without weakening the privacy boundary.
 */
export type NftGalleryItem = {
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
): readonly NftGalleryItem[] => {
  const onNetwork = watched.filter((nft) => nft.networkId === networkId);
  const watchedById = new Map(onNetwork.map((nft) => [nft.id, nft]));
  const spamIds = new Set(onNetwork.filter((nft) => nft.spam === true).map((nft) => nft.id));
  const discoveredIds = new Set(discovered.map((nft) => nft.id));
  const items: NftGalleryItem[] = [];
  for (const nft of discovered) {
    if (nft.networkId !== networkId || spamIds.has(nft.id)) {
      continue;
    }
    const attributes = nft.attributes ?? [];
    items.push({
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
  for (const nft of onNetwork) {
    if (nft.spam === true || discoveredIds.has(nft.id)) {
      continue;
    }
    items.push({
      attributes: [],
      collection: "",
      contract: nft.contract,
      description: "",
      id: nft.id,
      image: "",
      networkId: nft.networkId,
      pixelated: false,
      title: watchedTitle(nft),
      tokenId: nft.tokenId,
      watched: true,
    });
  }
  return items;
};

// The art tile: the placeholder icon always renders; a present image overlays it
// only when `reveal` is true, and is swapped back out to the placeholder by
// nft-ui when it fails to load. Images are withheld (placeholder only) for
// unsolicited auto-discovered NFTs until the user explicitly opens that NFT, so
// an airdropped tile cannot deanonymize the wallet (address -> IP) merely by the
// gallery painting a remote <img>. Solicited (manually watched) NFTs and the
// opened detail view reveal immediately.
/**
 * Renders a resolved NFT image only after the caller has established that the
 * user solicited it. Remote-load failure is handled by the shared NFT binding.
 * `eager` is reserved for the first visible gallery items and the detail hero
 * so those requests begin before a hidden Collectibles panel is opened.
 */
export const nftImageMarkup = (item: NftGalleryItem, reveal: boolean, eager = false): string =>
  reveal && item.image
    ? `<img class="nft-image${item.pixelated ? " nft-image--pixelated" : ""}" src="${escapeHtml(item.image)}" alt="" loading="${eager ? "eager" : "lazy"}" referrerpolicy="no-referrer" />`
    : "";

const nftArt = (item: NftGalleryItem, reveal: boolean, eager = false): string =>
  `<span class="nft-art">${nftImageMarkup(item, reveal, eager)}${icon("image")}</span>`;

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
      <code>${escapeHtml(accountLabel(nft.contract))} · #${escapeHtml(nft.tokenId)}</code>
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

/**
 * NFT gallery flow: an auto-discovered grid of owned collectibles merged with
 * manual watches, a hidden-as-spam section, and the manual add-by-ownership
 * form.
 */
export const nftGalleryFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  discoveredNfts: readonly DiscoveredNft[] = [],
): string => {
  const watched = preferences?.nfts ?? [];
  const visible = visibleNftItems(watched, discoveredNfts, status.networkId);
  const hidden = watched.filter((nft) => nft.networkId === status.networkId && nft.spam === true);
  return (
    flowHeader("NFTs", status, `${visible.length} shown`) +
    flowScreen(
      "nfts",
      `<section class="section">
        ${
          visible.length === 0
            ? emptyState(
                "No collectibles found for this account yet. Watch one you own below, or set an NFT indexer in Network settings to auto-discover them.",
              )
            : `<ul class="nft-grid">${visible.map((nft, index) => nftGalleryCard(nft, index < 4)).join("")}</ul>`
        }
      </section>
      ${
        hidden.length === 0
          ? ""
          : `<section class="section">
              <h2>Hidden</h2>
              <ul class="address-book">${hidden.map(hiddenRow).join("")}</ul>
            </section>`
      }
      <section class="section">
        <h2>Watch an NFT</h2>
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
          <span class="hint">The active account must own the token; ownership is checked on-chain before it is added.</span>
          ${button({
            disabled: account === null,
            icon: "check",
            label: "Add NFT",
            type: "submit",
          })}
          <p id="nft-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};

// Resolves the selected NFT for the detail screen from the rich discovery copy
// first, using its matching watch only for the label/action state. This avoids
// discarding fetched metadata for manually watched NFTs. A watch-only fallback
// still opens when discovery has not completed.
const selectedDetail = (
  preferences: WalletPreferences | null,
  discoveredNfts: readonly DiscoveredNft[],
  selectedNftId: string | null,
): NftGalleryItem | null => {
  const watched = (preferences?.nfts ?? []).find((nft) => nft.id === selectedNftId);
  const discovered = discoveredNfts.find((nft) => nft.id === selectedNftId);
  if (discovered) {
    return {
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
  return watched
    ? {
        attributes: [],
        collection: "",
        contract: watched.contract,
        description: "",
        id: watched.id,
        image: "",
        networkId: watched.networkId,
        pixelated: false,
        title: watchedTitle(watched),
        tokenId: watched.tokenId,
        watched: true,
      }
    : null;
};

/**
 * NFT detail flow: image and identifiers plus a send form through the verified
 * invoke path. Falls back to an empty state when the selection is no longer
 * owned or watched.
 */
export const nftDetailFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  selectedNftId: string | null,
  discoveredNfts: readonly DiscoveredNft[] = [],
): string => {
  const nft = selectedDetail(preferences, discoveredNfts, selectedNftId);
  return (
    flowHeader("NFT", status, nft ? nft.title : "") +
    flowScreen(
      "nft-detail",
      nft === null
        ? `<section class="section">${emptyState("This NFT is no longer watched.")}</section>`
        : `<section class="section">
            ${nft.image || nft.collection ? `<div class="nft-hero">${nftArt(nft, true, true)}${nft.collection ? `<p class="eyebrow">${escapeHtml(nft.collection)}</p>` : ""}</div>` : ""}
            ${nft.description ? `<p class="lede">${escapeHtml(nft.description)}</p>` : ""}
            ${receipt([
              { label: "Contract", value: accountLabel(nft.contract), valueStyle: "code" },
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
          <section class="section">
            <h2>Send</h2>
            ${account ? "" : noAccountEmpty(status)}
            <form id="nft-send-form">
              <input name="contract" type="hidden" value="${escapeHtml(nft.contract)}" />
              <input name="tokenId" type="hidden" value="${escapeHtml(nft.tokenId)}" />
              <input name="networkId" type="hidden" value="${escapeHtml(nft.networkId)}" />
              ${textField({
                autocomplete: "off",
                className: "mono",
                disabled: account === null,
                label: "Recipient",
                name: "recipient",
                placeholder: "0x…",
                required: true,
                spellcheck: false,
              })}
              <span class="hint">Ownership and token standard are re-checked on-chain. You will review the exact transfer, recipient, warnings, and fee before confirming.</span>
              <div id="nft-review-panel" aria-live="polite"></div>
              ${button({
                disabled: account === null,
                icon: "send",
                label: "Review transfer",
                type: "submit",
              })}
              <p id="nft-send-result" role="status"></p>
            </form>
          </section>`,
    )
  );
};
