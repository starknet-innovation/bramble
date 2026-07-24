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
import { icon } from "./icons";
import { accountLabel, flowHeader, flowScreen, noAccountEmpty } from "./parts";

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
  for (const nft of onNetwork) {
    if (nft.spam === true || discoveredIds.has(nft.id)) {
      continue;
    }
    items.push({
      animationUrl: "",
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

// The gallery-tile play affordance for a collectible with an on-chain animation:
// a button overlays the art square (revealed on hover/focus) and, when clicked,
// nft-ui points the adjacent sandboxed iframe at the renderer so the animation
// plays in place where the image would be. It sits outside the open button (no
// nested buttons) and only appears for watched, solicited tokens, so it never
// runs on gallery paint.
const nftTilePlay = (item: NftGalleryItem): string =>
  item.animationUrl
    ? `<button class="nft-play-tile" data-nft-play="${escapeHtml(item.animationUrl)}" type="button" aria-label="Play animation">${icon("gamepad")}<span>Play animation</span></button>
      <iframe class="nft-animation nft-animation--tile" title="Collectible animation" hidden></iframe>`
    : "";

// The Hide control: a watched entry toggles its stored spam flag; a
// discovered-only entry is persisted-as-spam by nft-ui using the data-* target.
const hideButton = (item: NftGalleryItem): string =>
  item.watched
    ? `<button class="ghost small" data-nft-spam="${escapeHtml(item.id)}" data-nft-spam-value="true" type="button">Hide</button>`
    : `<button class="ghost small" data-nft-hide="${escapeHtml(item.id)}" data-nft-hide-contract="${escapeHtml(item.contract)}" data-nft-hide-token="${escapeHtml(item.tokenId)}" data-nft-hide-network="${escapeHtml(item.networkId)}" data-nft-hide-name="${escapeHtml(item.title)}" type="button">Hide</button>`;

const nftCard = (item: NftGalleryItem, eager: boolean): string => `
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
  const visible = visibleNftItems(watched, discoveredNfts, status.networkId);
  const hidden = watched.filter((nft) => nft.networkId === status.networkId && nft.spam === true);
  return (
    flowHeader("NFTs", status, `${visible.length} shown`) +
    flowScreen(
      "nfts",
      `<section class="section">
        ${
          visible.length === 0
            ? '<p class="empty">No collectibles found for this account yet. Watch one you own below, or set an NFT indexer in Network settings to auto-discover them.</p>'
            : `<ul class="nft-grid">${visible.map((nft, index) => nftCard(nft, index < 4)).join("")}</ul>`
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
  return watched
    ? {
        animationUrl: "",
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

const attributeRows = (attributes: readonly NftAttribute[]): string =>
  attributes
    .map(
      (attribute) =>
        `<div class="receipt-row"><dt>${escapeHtml(attribute.traitType)}</dt><dd>${escapeHtml(attribute.value)}</dd></div>`,
    )
    .join("");

// The on-chain animation section: shown only when the resolved metadata carries a
// self-contained data:text/html animation. Nothing renders until the user presses
// play (preserving the anti-phone-home reveal boundary); on click, nft-ui points
// the iframe at the manifest-sandboxed sandbox/render.html page (opaque origin, no
// chrome.*, egress-blocking CSP) which renders the untrusted HTML in isolation.
// The URI is carried on the button's data-* and escaped into it here.
const nftAnimationSection = (item: NftGalleryItem): string =>
  item.animationUrl
    ? `<section class="section">
        <h2>Animation</h2>
        <span class="hint">This collectible renders its own animation on-chain. It runs isolated in a sandbox with no network access — nothing loads until you press play.</span>
        <button class="secondary small" data-nft-play="${escapeHtml(item.animationUrl)}" type="button">${icon("gamepad")}Play animation</button>
        <iframe class="nft-animation" title="Collectible animation" hidden></iframe>
      </section>`
    : "";

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
            ${nft.image || nft.collection ? `<div class="nft-hero">${nftArt(nft, true, true)}${nft.collection ? `<p class="eyebrow">${escapeHtml(nft.collection)}</p>` : ""}</div>` : ""}
            ${nft.description ? `<p class="lede">${escapeHtml(nft.description)}</p>` : ""}
            <dl class="receipt">
              <div class="receipt-row"><dt>Contract</dt><dd><code>${escapeHtml(accountLabel(nft.contract))}</code></dd></div>
              <div class="receipt-row"><dt>Token id</dt><dd><code>${escapeHtml(nft.tokenId)}</code></dd></div>
            </dl>
          </section>
          ${
            nft.attributes.length === 0
              ? ""
              : `<section class="section">
                  <h2>Attributes</h2>
                  <dl class="receipt">${attributeRows(nft.attributes)}</dl>
                </section>`
          }
          ${nftAnimationSection(nft)}
          <section class="section">
            <h2>Send</h2>
            ${account ? "" : noAccountEmpty(status)}
            <form id="nft-send-form">
              <input name="contract" type="hidden" value="${escapeHtml(nft.contract)}" />
              <input name="tokenId" type="hidden" value="${escapeHtml(nft.tokenId)}" />
              <input name="networkId" type="hidden" value="${escapeHtml(nft.networkId)}" />
              <label><span>Recipient</span><input class="mono" name="recipient" placeholder="0x…" required autocomplete="off" spellcheck="false" ${account ? "" : "disabled"} /></label>
              <span class="hint">Ownership and token standard are re-checked on-chain. You will review the exact transfer, recipient, warnings, and fee before confirming.</span>
              <div id="nft-review-panel" aria-live="polite"></div>
              <button type="submit" ${account ? "" : "disabled"}>${icon("send")}Review transfer</button>
              <p id="nft-send-result" role="status"></p>
            </form>
          </section>`,
    )
  );
};
