/**
 * Gate screens shown before the wallet dashboard: onboarding for first-run
 * wallet creation and the unlock screen for locked vaults. Both use a centered
 * brand mark, a large heading, and a primary action pinned to the bottom.
 */
import type { WalletStatus } from "../popup/responses";
import { BACKUP_VERIFY_POSITIONS } from "./backup-verify";
import { icon } from "./icons";
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
      <div id="backup-verify" class="stack" hidden>
        <span class="hint">Confirm you saved the phrase by re-typing these words.</span>
        <div class="verify-grid">${backupVerifyInputs()}</div>
        <p id="verify-result" role="status"></p>
      </div>
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        <button id="generate-button" class="secondary" type="button" ${status.ready ? "" : "disabled"}>${icon("refresh")}Generate phrase</button>
        <button type="submit" ${status.ready ? "" : "disabled"}>Create wallet</button>
      </div>
    </form>
  </main>`;

/**
 * Unlock screen for an existing but locked vault.
 */
export const locked = (status: WalletStatus): string => `
  <main class="screen gate">
    ${gateBrand()}
    <div class="gate-head">
      <h1>Welcome back</h1>
      <p class="lede">Unlock your wallet to continue.</p>
    </div>
    <form id="unlock-form" class="gate-form">
      <label><span>Vault passphrase</span><input name="vaultPassphrase" type="password" minlength="12" required autocomplete="current-password" placeholder="Enter your passphrase" /></label>
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        <button type="submit" ${status.ready ? "" : "disabled"}>Unlock</button>
      </div>
    </form>
  </main>`;
