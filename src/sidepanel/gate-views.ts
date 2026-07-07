/**
 * Gate screens shown before the wallet dashboard: onboarding for first-run
 * wallet creation and the unlock screen for locked vaults.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { BACKUP_VERIFY_POSITIONS } from "./backup-verify";
import { icon } from "./icons";
import { networkOptions } from "./parts";

const backupVerifyInputs = (): string =>
  BACKUP_VERIFY_POSITIONS.map(
    (position, index) =>
      `<label><span>Word ${position}</span><input name="verify-${index}" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>`,
  ).join("");

const standaloneHeader = (status: WalletStatus): string => `
  <header class="wallet-header">
    <div class="brand">
      <span class="brand-mark">${icon("wallet")}</span>
      <div class="brand-copy">
        <h1>MC Wallet</h1>
        <p class="brand-context">${escapeHtml(status.network)}</p>
      </div>
    </div>
  </header>`;

/**
 * First-run screen: create a wallet from a fresh or pasted recovery phrase.
 */
export const onboarding = (status: WalletStatus): string => `
  ${standaloneHeader(status)}
  <main class="screen">
    <section class="section">
      <div class="row"><h2>Create your wallet</h2><span class="pill"><span class="dot"></span>${escapeHtml(status.network)}</span></div>
      <p class="lede">Generate a fresh recovery phrase, or paste one you already have to import an existing wallet.</p>
      <form id="create-form">
        <label><span>Network</span><select name="networkId">${networkOptions(status)}</select></label>
        <label><span>Recovery phrase</span>
          <textarea name="mnemonic" required autocomplete="off" spellcheck="false" placeholder="12 or 24 words separated by spaces"></textarea>
          <span class="hint">Anyone with these words controls the wallet. Store them offline.</span>
        </label>
        <label><span>Vault passphrase</span>
          <input name="vaultPassphrase" type="password" minlength="12" required autocomplete="new-password" />
          <span class="hint">At least 12 characters. Unlocks the wallet on this device.</span>
        </label>
        <div id="backup-verify" class="stack" hidden>
          <span class="hint">Confirm you saved the phrase by re-typing these words.</span>
          <div class="verify-grid">${backupVerifyInputs()}</div>
          <p id="verify-result" role="status"></p>
        </div>
        <div class="button-row">
          <button id="generate-button" class="secondary" type="button" ${status.ready ? "" : "disabled"}>${icon("refresh")}Generate phrase</button>
          <button type="submit" ${status.ready ? "" : "disabled"}>${icon("wallet")}Create wallet</button>
        </div>
        <p id="form-result" role="status"></p>
      </form>
    </section>
  </main>`;

/**
 * Unlock screen for an existing but locked vault.
 */
export const locked = (status: WalletStatus): string => `
  ${standaloneHeader(status)}
  <main class="screen">
    <section class="section">
      <div class="row"><h2>Unlock your wallet</h2><span class="pill">${icon("lock")}Locked</span></div>
      <p class="lede">Enter the vault passphrase you chose when creating this wallet.</p>
      <form id="unlock-form">
        <label><span>Vault passphrase</span><input name="vaultPassphrase" type="password" minlength="12" required autocomplete="current-password" /></label>
        <button type="submit" ${status.ready ? "" : "disabled"}>${icon("lock")}Unlock</button>
        <p id="form-result" role="status"></p>
      </form>
    </section>
  </main>`;
