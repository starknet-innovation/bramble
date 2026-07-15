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
import type { WatchedNft } from "../storage/nft";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";
import { accountLabel, flowHeader, flowScreen, noAccountEmpty } from "./parts";

// One row in the gallery, normalized from either a discovered NFT (rich: image
// and collection) or a manually watched one (plain). `watched` marks entries
// that live in preferences so only those expose Remove; discovered-only entries
// expose a Hide that persists them as spam.
type GalleryItem = {
  readonly collection: string;
  readonly contract: string;
  readonly id: string;
  readonly image: string;
  readonly networkId: string;
  readonly title: string;
  readonly tokenId: string;
  readonly watched: boolean;
};

const watchedTitle = (nft: WatchedNft): string => nft.label ?? `NFT #${nft.tokenId}`;

const discoveredTitle = (nft: DiscoveredNft, watched: WatchedNft | undefined): string =>
  nft.name.length > 0 ? nft.name : (watched?.label ?? `NFT #${nft.tokenId}`);

// Builds the visible gallery rows for the active network by merging discovered
// NFTs (deduped against watched ones by id) with manually watched NFTs, dropping
// anything hidden as spam. Discovered rows win on collision so their image and
// collection are kept.
const visibleItems = (
  watched: readonly WatchedNft[],
  discovered: readonly DiscoveredNft[],
  networkId: string,
): readonly GalleryItem[] => {
  const onNetwork = watched.filter((nft) => nft.networkId === networkId);
  const watchedById = new Map(onNetwork.map((nft) => [nft.id, nft]));
  const spamIds = new Set(onNetwork.filter((nft) => nft.spam === true).map((nft) => nft.id));
  const discoveredIds = new Set(discovered.map((nft) => nft.id));
  const items: GalleryItem[] = [];
  for (const nft of discovered) {
    if (nft.networkId !== networkId || spamIds.has(nft.id)) {
      continue;
    }
    items.push({
      collection: nft.collection,
      contract: nft.contract,
      id: nft.id,
      image: nft.image,
      networkId: nft.networkId,
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
      collection: "",
      contract: nft.contract,
      id: nft.id,
      image: "",
      networkId: nft.networkId,
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
const nftArt = (image: string, reveal: boolean): string =>
  `<span class="nft-art">${
    reveal && image
      ? `<img class="nft-image" src="${escapeHtml(image)}" alt="" loading="lazy" />`
      : ""
  }${icon("image")}</span>`;

// The Hide control: a watched entry toggles its stored spam flag; a
// discovered-only entry is persisted-as-spam by nft-ui using the data-* target.
const hideButton = (item: GalleryItem): string =>
  item.watched
    ? `<button class="ghost small" data-nft-spam="${escapeHtml(item.id)}" data-nft-spam-value="true" type="button">Hide</button>`
    : `<button class="ghost small" data-nft-hide="${escapeHtml(item.id)}" data-nft-hide-contract="${escapeHtml(item.contract)}" data-nft-hide-token="${escapeHtml(item.tokenId)}" data-nft-hide-network="${escapeHtml(item.networkId)}" data-nft-hide-name="${escapeHtml(item.title)}" type="button">Hide</button>`;

const nftCard = (item: GalleryItem): string => `
  <li class="nft-card">
    <button class="nft-open" data-nft-open="${escapeHtml(item.id)}" type="button">
      ${nftArt(item.image, item.watched)}
      <span class="nft-copy">
        <strong>${escapeHtml(item.title)}</strong>
        <code>${escapeHtml(item.collection || accountLabel(item.contract))} · #${escapeHtml(item.tokenId)}</code>
      </span>
    </button>
    <div class="nft-actions">
      ${hideButton(item)}
      ${
        item.watched
          ? `<button class="ghost small danger" data-remove-nft="${escapeHtml(item.id)}" type="button">Remove</button>`
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
    <button class="secondary small" data-nft-spam="${escapeHtml(nft.id)}" data-nft-spam-value="false" type="button">${icon("check")}Unhide</button>
    <button class="icon-button danger" data-remove-nft="${escapeHtml(nft.id)}" type="button" aria-label="Remove" title="Remove">${icon("x")}</button>
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
  const visible = visibleItems(watched, discoveredNfts, status.networkId);
  const hidden = watched.filter((nft) => nft.networkId === status.networkId && nft.spam === true);
  return (
    flowHeader("NFTs", status, `${visible.length} shown`) +
    flowScreen(
      "nfts",
      `<section class="section">
        ${
          visible.length === 0
            ? '<p class="empty">No collectibles found for this account yet. Watch one you own below, or set an NFT indexer in Network settings to auto-discover them.</p>'
            : `<ul class="nft-grid">${visible.map(nftCard).join("")}</ul>`
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
          <label><span>Contract</span><input class="mono" name="contract" placeholder="0x…" required autocomplete="off" spellcheck="false" ${account ? "" : "disabled"} /></label>
          <label><span>Token id</span><input class="mono" name="tokenId" inputmode="numeric" placeholder="0" required autocomplete="off" ${account ? "" : "disabled"} /></label>
          <label><span>Label (optional)</span><input name="label" maxlength="64" autocomplete="off" ${account ? "" : "disabled"} /></label>
          <span class="hint">The active account must own the token; ownership is checked on-chain before it is added.</span>
          <button type="submit" ${account ? "" : "disabled"}>${icon("check")}Add NFT</button>
          <p id="nft-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};

// Resolves the selected NFT for the detail screen from watched NFTs first, then
// from the auto-discovered list, so a gallery entry the account owns but has not
// manually watched still opens.
const selectedDetail = (
  preferences: WalletPreferences | null,
  discoveredNfts: readonly DiscoveredNft[],
  selectedNftId: string | null,
): GalleryItem | null => {
  const watched = (preferences?.nfts ?? []).find((nft) => nft.id === selectedNftId);
  if (watched) {
    return {
      collection: "",
      contract: watched.contract,
      id: watched.id,
      image: "",
      networkId: watched.networkId,
      title: watchedTitle(watched),
      tokenId: watched.tokenId,
      watched: true,
    };
  }
  const discovered = discoveredNfts.find((nft) => nft.id === selectedNftId);
  return discovered
    ? {
        collection: discovered.collection,
        contract: discovered.contract,
        id: discovered.id,
        image: discovered.image,
        networkId: discovered.networkId,
        title: discoveredTitle(discovered, undefined),
        tokenId: discovered.tokenId,
        watched: false,
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
        ? '<section class="section"><p class="empty">This NFT is no longer watched.</p></section>'
        : `<section class="section">
            ${nft.image || nft.collection ? `<div class="nft-hero">${nftArt(nft.image, true)}${nft.collection ? `<p class="eyebrow">${escapeHtml(nft.collection)}</p>` : ""}</div>` : ""}
            <p class="eyebrow">Contract</p>
            <div class="address-line"><code>${escapeHtml(nft.contract)}</code></div>
            <p class="eyebrow">Token id</p>
            <div class="address-line"><code>${escapeHtml(nft.tokenId)}</code></div>
          </section>
          <section class="section">
            <h2>Send</h2>
            ${account ? "" : noAccountEmpty(status)}
            <form id="nft-send-form">
              <input name="contract" type="hidden" value="${escapeHtml(nft.contract)}" />
              <input name="tokenId" type="hidden" value="${escapeHtml(nft.tokenId)}" />
              <input name="networkId" type="hidden" value="${escapeHtml(nft.networkId)}" />
              <label><span>Recipient</span><input class="mono" name="recipient" placeholder="0x…" required autocomplete="off" spellcheck="false" ${account ? "" : "disabled"} /></label>
              <span class="hint">Sends this token with transfer_from. Ownership is re-checked and the recipient is screened for address-poisoning before signing.</span>
              <button type="submit" ${account ? "" : "disabled"}>${icon("send")}Send NFT</button>
              <p id="nft-send-result" role="status"></p>
            </form>
          </section>`,
    )
  );
};
