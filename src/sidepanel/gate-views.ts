/**
 * Gate screens shown before the wallet dashboard: onboarding for first-run
 * wallet creation and the unlock screen for locked vaults. Both use a centered
 * brand mark, a large heading, and a primary action pinned to the bottom.
 */
import type { PendingApproval, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { BACKUP_VERIFY_POSITIONS } from "./backup-verify";
import { icon } from "./icons";
import { requiresMainnetAck } from "./mainnet-ack";
import { networkOptions } from "./parts";

const backupVerifyInputs = (): string =>
  BACKUP_VERIFY_POSITIONS.map(
    (position, index) =>
      `<label><span>Word ${position}</span><input name="verify-${index}" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>`,
  ).join("");

const gateBrand = (): string => `<div class="gate-brand">${icon("wallet")}</div>`;

/**
 * First-run screen: create a wallet from a fresh or pasted recovery phrase.
 */
export const onboarding = (status: WalletStatus): string => `
  <main class="screen gate">
    ${gateBrand()}
    <div class="gate-head">
      <h1>Create your wallet</h1>
      <p class="lede">Generate a fresh recovery phrase, or paste one you already have to import an existing wallet.</p>
    </div>
    <a class="onboarding-launch" href="onboarding.html" target="_blank" rel="noopener">Open full-screen setup</a>
    <form id="create-form" class="gate-form">
      <label><span>Network</span><select name="networkId">${networkOptions(status)}</select></label>
      <label><span>Recovery phrase</span>
        <textarea name="mnemonic" required autocomplete="off" spellcheck="false" placeholder="12 or 24 words separated by spaces"></textarea>
        <span class="hint">Anyone with these words controls the wallet. Store them offline.</span>
      </label>
      <button id="phrase-toggle" class="secondary small" type="button" hidden>${icon("book")}Tap to show phrase</button>
      <label><span>Vault passphrase</span>
        <input name="vaultPassphrase" type="password" minlength="12" required autocomplete="new-password" placeholder="At least 12 characters" />
        <span class="hint">Unlocks the wallet on this device.</span>
      </label>
      <p id="passphrase-result" role="status"></p>
      <div id="backup-verify" class="stack" hidden>
        <span class="hint">Confirm you saved the phrase by re-typing these words.</span>
        <div class="verify-grid">${backupVerifyInputs()}</div>
        <p id="verify-result" role="status"></p>
      </div>
      <label id="mainnet-ack" class="hint"${requiresMainnetAck(status.networkId) ? "" : " hidden"}>
        <input name="mainnetAck" type="checkbox" />
        <span>You are creating a wallet on Starknet Mainnet with real funds.</span>
      </label>
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        <button id="generate-button" class="secondary" type="button" ${status.ready ? "" : "disabled"}>${icon("refresh")}Generate phrase</button>
        <button type="submit" ${status.ready ? "" : "disabled"}>Create wallet</button>
      </div>
    </form>
    ${ledgerSetupCard(status)}
  </main>`;

/**
 * First-run Ledger card: set up a brand-new wallet backed by a Ledger with no
 * recovery phrase generated. The user still sets an unlock passphrase (it
 * encrypts the account registry); connecting the device and picking accounts
 * happens in the onboarding overlay after this passphrase is captured.
 */
const ledgerSetupCard = (status: WalletStatus): string => `
    <div class="gate-alt">
      <p class="eyebrow">Or set up with a Ledger</p>
      <p class="lede">Back this wallet with a Ledger hardware device. No recovery phrase is generated — your keys stay on the device.</p>
      <form id="ledger-setup-form" class="gate-form">
        <label><span>Network</span><select name="ledgerNetworkId">${networkOptions(status)}</select></label>
        <label><span>Vault passphrase</span>
          <input name="ledgerVaultPassphrase" type="password" minlength="12" required autocomplete="new-password" placeholder="At least 12 characters" />
          <span class="hint">Unlocks the wallet on this device. It protects the account list — no key material is stored.</span>
        </label>
        <p id="ledger-passphrase-result" role="status"></p>
        <label id="ledger-mainnet-ack" class="hint"${requiresMainnetAck(status.networkId) ? "" : " hidden"}>
          <input name="ledgerMainnetAck" type="checkbox" />
          <span>You are setting up a wallet on Starknet Mainnet with real funds.</span>
        </label>
        <div class="gate-cta">
          <button id="ledger-setup-button" class="secondary" data-ledger-first-run type="button" ${status.ready ? "" : "disabled"}>${icon("shield")}Set up with a Ledger</button>
        </div>
      </form>
    </div>`;

/**
 * Unlock screen for an existing but locked vault.
 */
export const locked = (status: WalletStatus, pending: readonly PendingApproval[] = []): string => {
  const request = pending[0];
  return `
  <main class="screen gate">
    ${gateBrand()}
    <div class="gate-head">
      <h1>Welcome back</h1>
      <p class="lede">${request ? "Unlock to review the wallet request waiting for you." : "Unlock your wallet to continue."}</p>
    </div>
    ${
      request
        ? `<div class="callout gate-request" role="status">
            <span class="callout-icon">${icon("link")}</span>
            <span class="callout-copy"><strong>Site request waiting</strong><p>${escapeHtml(request.origin)}</p></span>
          </div>`
        : ""
    }
    <form id="unlock-form" class="gate-form">
      <label><span>Vault passphrase</span><input name="vaultPassphrase" type="password" minlength="12" required autocomplete="current-password" placeholder="Enter your passphrase" /></label>
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        <button type="submit" ${status.ready ? "" : "disabled"}>Unlock</button>
      </div>
    </form>
  </main>`;
};
