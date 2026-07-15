/**
 * Dedicated flow screens. Each opens from a dock screen, focuses on one goal
 * — send, receive, switch network, switch account, manage addresses — and
 * returns through its back control, so journeys never blur into the home
 * screen.
 */
import type { ConnectedSite, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { knownAccountType } from "../starknet/account-types";
import { isStarknetNetworkId } from "../starknet/networks";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { accountGroupsLine } from "./group-controls";
import { groupsSection } from "./group-members";
import { icon } from "./icons";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  copyButton,
  flowHeader,
  flowScreen,
  noAccountEmpty,
} from "./parts";
import { qrSvg } from "./qr";

/**
 * Send flow: pick a token, a recipient, and an amount, then submit.
 */
export const sendFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const tokens = preferences?.tokens.filter((token) => token.networkId === status.networkId) ?? [];
  const addresses =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  const canSend = account !== null && tokens.length > 0;
  return (
    flowHeader("Send", status, account ? `From ${accountLabel(account.address)}` : "") +
    flowScreen(
      "send",
      `<section class="section">
        ${account ? "" : noAccountEmpty(status)}
        ${
          account && tokens.length === 0
            ? '<p class="empty">No tokens are tracked on this network yet, so nothing can be sent.</p>'
            : ""
        }
        <form id="transfer-form">
          <input name="accountId" type="hidden" value="${escapeHtml(account?.id ?? "")}" />
          <label><span>Token</span>
            <select name="tokenId" ${canSend ? "" : "disabled"}>
              ${tokens.map((token) => `<option value="${escapeHtml(token.id)}">${escapeHtml(token.symbol)} — ${escapeHtml(token.name)}</option>`).join("")}
            </select>
          </label>
          <label><span>Recipient</span>
            <input class="mono" name="recipient" list="address-book" placeholder="0x…" required autocomplete="off" spellcheck="false" ${canSend ? "" : "disabled"} />
            <span class="hint">Paste an address or pick a saved one from your address book.</span>
          </label>
          <label><span>Amount</span>
            <input class="mono" name="amount" inputmode="decimal" placeholder="0.0" required autocomplete="off" ${canSend ? "" : "disabled"} />
          </label>
          <label><span>Speed</span>
            <select name="speed" ${canSend ? "" : "disabled"}>
              <option value="standard" selected>Standard</option>
              <option value="fast">Fast — pays up to 1.5x the estimated fee</option>
            </select>
          </label>
          <div id="review-panel"></div>
          <button type="submit" ${canSend ? "" : "disabled"}>${icon("send")}Review send</button>
          <p id="transfer-result" role="status"></p>
        </form>
        <datalist id="address-book">${addresses.map((entry) => `<option value="${escapeHtml(entry.address)}">${escapeHtml(entry.label)}</option>`).join("")}</datalist>
      </section>`,
    )
  );
};

/**
 * Receive flow: show and copy the active account address.
 */
export const receiveFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Receive", status) +
  flowScreen(
    "receive",
    `<section class="section">
      ${
        account
          ? `<div class="stack">
              <div class="qr-card">${qrSvg(account.address)}</div>
              <p class="eyebrow">Your address</p>
              <div class="address-line">
                <code>${escapeHtml(account.address)}</code>
                ${copyButton(account.address, "Copy address")}
              </div>
              <button data-copy="${escapeHtml(account.address)}" type="button">${icon("copy")}Copy address</button>
              <p class="hint">Only send ${escapeHtml(status.network)} assets to this address.</p>
            </div>`
          : noAccountEmpty(status)
      }
      <p id="receive-result" role="status"></p>
    </section>`,
  );

const rpcOverrideFor = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  preferences && isStarknetNetworkId(status.networkId)
    ? (preferences.rpcOverrides?.[status.networkId] ?? "")
    : "";

const strk20ProverUrlFor = (preferences: WalletPreferences | null): string =>
  preferences?.strk20ProverUrl ?? "";

const nftIndexerUrlFor = (preferences: WalletPreferences | null): string =>
  preferences?.nftIndexerUrl ?? "";

/**
 * Network flow: switch the active network and set a custom RPC endpoint.
 */
export const networkFlow = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  flowHeader("Network", status, "Choose where the wallet operates") +
  flowScreen(
    "network",
    `<section class="section">
      <div class="option-list" role="group" aria-label="Networks">
        ${status.networks
          .map(
            (
              network,
            ) => `<button class="option-row" data-network-id="${escapeHtml(network.id)}" type="button" aria-pressed="${network.id === status.networkId}">
              <span class="option-copy">
                <strong>${escapeHtml(network.name)}</strong>
                <code>${escapeHtml(network.id)}</code>
              </span>
              ${network.id === status.networkId ? `<span class="option-mark">${icon("check")}</span>` : ""}
            </button>`,
          )
          .join("")}
      </div>
      <p class="hint">Switching selects or derives an account on the target network.</p>
      <p id="picker-result" role="status"></p>
    </section>
    <section class="section">
      <h2>RPC endpoint</h2>
      <form id="rpc-form">
        <label><span>Custom endpoint for ${escapeHtml(status.network)}</span>
          <input class="mono" name="rpcUrl" type="url" placeholder="https://…" value="${escapeHtml(rpcOverrideFor(status, preferences))}" autocomplete="off" spellcheck="false" />
          <span class="hint">Used as the default when set. Leave empty to use the built-in endpoint.</span>
        </label>
        <button class="secondary" type="submit">${icon("check")}Save endpoint</button>
        <p id="rpc-result" role="status"></p>
      </form>
    </section>
    <section class="section">
      <h2>STRK20 prover</h2>
      <form id="strk20-prover-form">
        <label><span>Privacy prover endpoint</span>
          <input class="mono" name="proverUrl" type="url" placeholder="https://…" value="${escapeHtml(strk20ProverUrlFor(preferences))}" autocomplete="off" spellcheck="false" />
          <span class="hint">Where the wallet requests STRK20 proofs. Leave empty to keep privacy features off.</span>
        </label>
        <button class="secondary" type="submit">${icon("check")}Save prover</button>
        <p id="strk20-prover-result" role="status"></p>
      </form>
    </section>
    <section class="section">
      <h2>NFT indexer</h2>
      <form id="nft-indexer-form">
        <label><span>NFT discovery endpoint</span>
          <input class="mono" name="indexerUrl" type="url" placeholder="https://…" value="${escapeHtml(nftIndexerUrlFor(preferences))}" autocomplete="off" spellcheck="false" />
          <span class="hint">Where the wallet lists NFTs an account owns for the auto-discovered gallery. Ownership is re-checked on-chain. Leave empty to only show manually watched NFTs.</span>
        </label>
        <button class="secondary" type="submit">${icon("check")}Save indexer</button>
        <p id="nft-indexer-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Manage accounts & groups flow: the single management surface reached from the
 * drawer's "Manage accounts & groups" entry and the Settings menu. Switch the
 * active account, add one, manage groups (create/rename/change-icon/delete plus
 * bulk assignment) in the Groups accordion, name the account, and inspect
 * identifiers. `expandedGroupId` selects the one open Groups panel — a group's
 * bulk members editor or the "Create a group" panel (null = all collapsed).
 */
export const accountFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  expandedGroupId: string | null = null,
): string => {
  const networkAccounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const accountType = account ? knownAccountType(account.classHash) : null;
  const groups = preferences?.groups ?? [];
  return (
    flowHeader("Accounts & groups", status, `On ${status.network}`) +
    flowScreen(
      "account",
      `<section class="section">
        ${
          networkAccounts.length === 0
            ? noAccountEmpty(status)
            : `<div class="option-list" role="group" aria-label="Accounts">
                ${networkAccounts
                  .map((stored) => {
                    const memberGroups = groups.filter((group) =>
                      group.accountIds.includes(stored.id),
                    );
                    return `<button class="option-row" data-account-id="${escapeHtml(stored.id)}" type="button" aria-pressed="${stored.id === account?.id}">
                          <span class="option-avatar">${accountAvatar(stored.address)}</span>
                          <span class="option-copy">
                            <strong>${escapeHtml(accountDisplayName(stored, preferences))}</strong>
                            <code>${accountLabel(stored.address)}</code>
                            ${accountGroupsLine(memberGroups)}
                          </span>
                          ${stored.id === account?.id ? `<span class="option-mark">${icon("check")}</span>` : ""}
                        </button>`;
                  })
                  .join("")}
              </div>`
        }
        <p id="picker-result" role="status"></p>
      </section>
      <section class="section">
        <h2>Add account</h2>
        <p class="hint">Derives the next account on ${escapeHtml(status.network)} from this wallet's recovery phrase.</p>
        <button id="new-account" class="secondary" type="button">${icon("wallet")}Add account</button>
        <p id="new-account-result" role="status"></p>
      </section>
      ${groupsSection(groups, status.accounts, preferences, expandedGroupId, status.networks)}
      ${
        account
          ? `<section class="section">
              <h2>Name this account</h2>
              <form id="label-form">
                <label><span>Label</span>
                  <input name="label" maxlength="64" value="${escapeHtml(preferences?.accountLabels?.[account.id] ?? "")}" placeholder="${accountLabel(account.address)}" autocomplete="off" />
                  <span class="hint">Shown instead of the address. Leave empty to clear.</span>
                </label>
                <button class="secondary" type="submit">${icon("check")}Save label</button>
                <p id="label-result" role="status"></p>
              </form>
            </section>
            <section class="section">
              <h2>Active account details</h2>
              <p class="eyebrow">Address</p>
              <div class="address-line"><code>${escapeHtml(account.address)}</code>${copyButton(account.address, "Copy address")}</div>
              <p class="eyebrow">Class hash</p>
              <div class="address-line"><code>${escapeHtml(account.classHash)}</code>${copyButton(account.classHash, "Copy class hash")}</div>
              ${
                accountType
                  ? `<p class="eyebrow">Account type</p>
              <div class="address-line"><code>${escapeHtml(accountType)}</code></div>`
                  : ""
              }
            </section>`
          : ""
      }`,
    )
  );
};

/**
 * Backup flow: export or restore non-secret wallet data. Never includes the
 * vault or any key material.
 */
export const backupFlow = (status: WalletStatus): string =>
  flowHeader("Backup & restore", status, "Preferences, labels, and contacts") +
  flowScreen(
    "backup",
    `<section class="section">
      <h2>Export</h2>
      <p class="hint">Downloads tokens, contacts, labels, and settings as JSON. Your recovery phrase and keys are never included.</p>
      <button id="backup-export" class="secondary" type="button">${icon("receive")}Download backup</button>
      <p id="backup-result" role="status"></p>
    </section>
    <section class="section">
      <h2>Restore</h2>
      <p class="hint">Replaces current preferences with a backup file exported from this wallet.</p>
      <label><span>Backup file</span><input id="backup-file" type="file" accept="application/json" /></label>
      <button id="backup-import" class="secondary" type="button">${icon("check")}Restore backup</button>
    </section>`,
  );

/**
 * Connected sites flow: list origins with active grants and revoke access.
 * Reachable from settings; reads its list from the background permissions
 * store and returns through the flow header back control.
 */
export const connectedSitesFlow = (status: WalletStatus, sites: readonly ConnectedSite[]): string =>
  flowHeader("Connected sites", status, `${sites.length} connected`) +
  flowScreen(
    "connected-sites",
    `<section class="section">
      <p class="hint">Connected sites can see your granted account addresses. Revoke any you no longer trust; the site is asked to reconnect next time.</p>
      ${
        sites.length === 0
          ? '<p class="empty">No sites are connected yet. Approving a connection request lists the site here.</p>'
          : `<ul class="address-book">${sites
              .map(
                (site) => `<li class="address-line">
                    <div class="stack-tight">
                      <strong class="request-origin">${escapeHtml(site.origin)}</strong>
                      <span class="hint">${site.accountCount} account${site.accountCount === 1 ? "" : "s"} shared</span>
                    </div>
                    <button class="icon-button danger" data-revoke-origin="${escapeHtml(site.origin)}" type="button" aria-label="Revoke ${escapeHtml(site.origin)}" title="Revoke ${escapeHtml(site.origin)}">${icon("x")}</button>
                  </li>`,
              )
              .join("")}</ul>`
      }
      <p id="connected-sites-result" role="status"></p>
    </section>`,
  );

/**
 * Address book flow: save and reuse recipient addresses for this network.
 */
export const addressBookFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string => {
  const addresses =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  return (
    flowHeader("Address book", status, `${addresses.length} saved`) +
    flowScreen(
      "address-book",
      `<section class="section">
        <form id="address-form">
          <input name="networkId" type="hidden" value="${escapeHtml(status.networkId)}" />
          <label><span>Label</span><input name="label" required autocomplete="off" /></label>
          <label><span>Address</span><input class="mono" name="address" placeholder="0x…" required autocomplete="off" spellcheck="false" /></label>
          <span class="hint">Saving an existing address updates its label.</span>
          <button class="secondary" type="submit">${icon("check")}Save address</button>
          <p id="address-result" role="status"></p>
        </form>
      </section>
      <section class="section">
        <h2>Saved addresses</h2>
        ${
          addresses.length === 0
            ? '<p class="empty">No saved addresses yet. Save one to reuse it when sending.</p>'
            : `<ul class="address-book">${addresses
                .map(
                  (entry) => `<li class="address-line">
                    <div class="stack-tight">
                      <strong>${escapeHtml(entry.label)}</strong>
                      <code>${escapeHtml(entry.address)}</code>
                    </div>
                    ${copyButton(entry.address, `Copy ${entry.label}`)}
                    <button class="icon-button danger" data-remove-address="${escapeHtml(entry.id)}" type="button" aria-label="Remove ${escapeHtml(entry.label)}" title="Remove ${escapeHtml(entry.label)}">${icon("x")}</button>
                  </li>`,
                )
                .join("")}</ul>`
        }
      </section>`,
    )
  );
};
