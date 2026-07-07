/**
 * NFT gallery and detail flow screens. The gallery grids the watched NFTs for
 * the active network, hides spam behind a toggle, and adds new ones after
 * on-chain ownership is proven. Metadata images are not fetched: the extension
 * ships a tight host-permission and CSP allowlist, so remote image loading is a
 * documented follow-up. Detail sends through the verified invoke path.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { WatchedNft } from "../storage/nft";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";
import { accountLabel, flowHeader, flowScreen, noAccountEmpty } from "./parts";

const nftTitle = (nft: WatchedNft): string => nft.label ?? `NFT #${nft.tokenId}`;

const nftCard = (nft: WatchedNft): string => `
  <li class="nft-card">
    <button class="secondary nft-open" data-nft-open="${escapeHtml(nft.id)}" type="button">
      <span class="nft-mark">${icon("wallet")}</span>
      <span class="nft-copy">
        <strong>${escapeHtml(nftTitle(nft))}</strong>
        <code>${escapeHtml(accountLabel(nft.contract))}</code>
        <span class="hint">#${escapeHtml(nft.tokenId)}</span>
      </span>
    </button>
    <div class="nft-actions">
      <button class="secondary small" data-nft-spam="${escapeHtml(nft.id)}" data-nft-spam-value="true" type="button">${icon("x")}Hide</button>
      <button class="secondary small danger" data-remove-nft="${escapeHtml(nft.id)}" type="button">${icon("x")}Remove</button>
    </div>
  </li>`;

const hiddenRow = (nft: WatchedNft): string => `
  <li class="address-line">
    <div class="stack-tight">
      <strong>${escapeHtml(nftTitle(nft))}</strong>
      <code>${escapeHtml(accountLabel(nft.contract))} · #${escapeHtml(nft.tokenId)}</code>
    </div>
    <button class="secondary small" data-nft-spam="${escapeHtml(nft.id)}" data-nft-spam-value="false" type="button">${icon("check")}Unhide</button>
    <button class="icon-button danger" data-remove-nft="${escapeHtml(nft.id)}" type="button" aria-label="Remove" title="Remove">${icon("x")}</button>
  </li>`;

/**
 * NFT gallery flow: grid of watched collectibles plus the add-by-ownership form.
 */
export const nftGalleryFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const nfts = (preferences?.nfts ?? []).filter((nft) => nft.networkId === status.networkId);
  const visible = nfts.filter((nft) => nft.spam !== true);
  const hidden = nfts.filter((nft) => nft.spam === true);
  return (
    flowHeader("NFTs", "home", status, `${visible.length} shown`) +
    flowScreen(
      "nfts",
      `<section class="section">
        ${
          visible.length === 0
            ? '<p class="empty">No collectibles watched on this network yet. Add one you own below.</p>'
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

/**
 * NFT detail flow: identifiers plus a send form through the verified invoke
 * path. Falls back to an empty state when the selection is no longer watched.
 */
export const nftDetailFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  selectedNftId: string | null,
): string => {
  const nft = (preferences?.nfts ?? []).find((watched) => watched.id === selectedNftId) ?? null;
  return (
    flowHeader("NFT", "nfts", status, nft ? nftTitle(nft) : "") +
    flowScreen(
      "nft-detail",
      nft === null
        ? '<section class="section"><p class="empty">This NFT is no longer watched.</p></section>'
        : `<section class="section">
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
