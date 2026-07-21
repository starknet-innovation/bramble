/**
 * Reveal-secrets flow: a settings-reachable screen that re-authenticates the
 * user, then shows the wallet recovery phrase and the active account private
 * key blurred until tapped. Secrets are injected into the DOM only after a
 * fresh passphrase check, are never written to storage, and are wiped whenever
 * the shell re-renders (leaving the screen).
 */
import type { WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { icon } from "./icons";
import { flowHeader, flowScreen } from "./parts";
import type { SidepanelWallet } from "./runtime";

/**
 * Dependencies the reveal binding closes over.
 */
export type RevealUiDeps = {
  readonly app: Element | null;
  readonly wallet: SidepanelWallet;
};

/**
 * Reveal flow screen: strong warning, a re-auth form, and a blurred output
 * region filled in only after the passphrase is confirmed.
 *
 * When the active account was imported from a raw key it is not derived from
 * the wallet recovery phrase, so the phrase does not restore it. The screen
 * makes that explicit — the imported key below is its only backup — using the
 * account provenance already present in `status`; no secret is consulted here.
 */
export const revealFlow = (status: WalletStatus): string => {
  const activeAccount = status.accounts.find((stored) => stored.id === status.activeAccountId);
  const activeIsImported = activeAccount?.derivation.kind === "imported-raw-key";
  // A Ledger account's private key never leaves the device, so there is no phrase
  // or key to reveal here. Show the device-recovery note instead of the reveal
  // form — never fabricate or display a phrase for a hardware account.
  if (activeAccount?.derivation.kind === "ledger") {
    return (
      flowHeader("Reveal secrets", status, "Hardware account") +
      flowScreen(
        "reveal",
        `<section class="section" role="note">
          <p class="eyebrow">Recovery</p>
          <p class="hint">This account lives on your Ledger. Its keys never leave the device, so there is no recovery phrase or private key to reveal here. Recover this account from your Ledger device itself, using the recovery phrase you set up with Ledger — not this wallet.</p>
        </section>`,
      )
    );
  }
  return (
    flowHeader("Reveal secrets", status, "Recovery phrase and active key") +
    flowScreen(
      "reveal",
      `<section class="section reveal-warning" role="note">
      <p class="reveal-danger">${icon("alert")}Anyone who sees these can take your funds.</p>
      <p class="hint">Reveal only in private. MC Wallet will never ask you for them. They are shown once here and never leave this screen.</p>
    </section>
    <section class="section">
      <form id="reveal-form">
        <label><span>Confirm vault passphrase</span>
          <input name="vaultPassphrase" type="password" minlength="12" required autocomplete="current-password" />
          <span class="hint">Re-enter it to reveal. An unlocked session alone is not enough.</span>
        </label>
        <button type="submit">${icon("lock")}Reveal secrets</button>
        <p id="reveal-result" role="status"></p>
      </form>
      <div id="reveal-output" class="reveal-output" hidden>
        <p class="eyebrow">Recovery phrase</p>
        <div class="reveal-value is-masked" id="reveal-phrase"></div>
        <p class="eyebrow">Active account private key${activeIsImported ? " (imported)" : ""}</p>
        <code class="reveal-value is-masked" id="reveal-key"></code>
        ${
          activeIsImported
            ? '<p class="hint" id="reveal-imported-note">This account was imported from a raw key, so the wallet recovery phrase above does not restore it — its private key shown here is its only backup.</p>'
            : ""
        }
        <button id="reveal-toggle" class="secondary" type="button">${icon("check")}Tap to show</button>
        <p class="hint">Write them down offline. Leaving this screen hides them again.</p>
      </div>
    </section>`,
    )
  );
};

/**
 * Binds the reveal form: confirm the passphrase, then show blurred secrets with
 * a tap-to-toggle mask. Nothing is persisted.
 */
export const bindReveal = (deps: RevealUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#reveal-form");
  const result = deps.app?.querySelector<HTMLElement>("#reveal-result");
  const output = deps.app?.querySelector<HTMLElement>("#reveal-output");
  const phraseEl = deps.app?.querySelector<HTMLElement>("#reveal-phrase");
  const keyEl = deps.app?.querySelector<HTMLElement>("#reveal-key");
  const toggle = deps.app?.querySelector<HTMLButtonElement>("#reveal-toggle");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  toggle?.addEventListener("click", () => {
    const masked = phraseEl?.classList.toggle("is-masked") ?? true;
    keyEl?.classList.toggle("is-masked", masked);
    toggle.lastChild?.replaceWith(masked ? "Tap to show" : "Tap to hide");
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = String(new FormData(form).get("vaultPassphrase") ?? "");
    buttonBusy(submitButton, true);
    void deps.wallet.revealSecrets(value).then(
      (secrets) => {
        if (phraseEl) {
          phraseEl.textContent =
            secrets.mnemonic ?? "No recovery phrase is stored for this wallet.";
        }
        if (keyEl) {
          keyEl.textContent = secrets.privateKey;
        }
        output?.removeAttribute("hidden");
        if (result) {
          result.textContent = "Revealed. Tap to show, then write it down offline.";
        }
        form.reset();
        buttonBusy(submitButton, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Reveal failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Reveal failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};
