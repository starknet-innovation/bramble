/**
 * Reveal-secrets flow: a settings-reachable screen that re-authenticates the
 * user, then shows the wallet recovery phrase and the active account private
 * key blurred until tapped. Secrets are injected into the DOM only after a
 * fresh passphrase check, are never written to storage, and are wiped whenever
 * the shell re-renders (leaving the screen).
 *
 * The phrase may also be copied to the system clipboard. That is a deliberate
 * widening of where the secret can live — the clipboard is readable by every
 * application on the machine and may sync between devices — so the copy is
 * offered only after the same re-auth that reveals the phrase, the screen says
 * plainly what the user is accepting, and a best-effort timer overwrites the
 * clipboard afterwards. Best-effort is the honest word: the panel can be closed
 * before the timer fires, and a clipboard manager's own history is beyond reach.
 */

import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { icon } from "../../shared/icons";
import { flowHeader, flowScreen } from "../../shared/parts";

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
      <p class="hint">Reveal only in private. Bramble will never ask you for them. They are shown once here and never leave this screen.</p>
    </section>
    <section class="section">
      <form id="reveal-form">
        ${textField({
          autocomplete: "current-password",
          hint: "Re-enter it to reveal. An unlocked session alone is not enough.",
          label: "Confirm vault passphrase",
          minlength: 12,
          name: "vaultPassphrase",
          required: true,
          type: "password",
        })}
        ${button({ icon: "lock", label: "Reveal secrets", type: "submit" })}
        <p id="reveal-result" role="status"></p>
      </form>
      <div id="reveal-output" class="reveal-output" hidden>
        <p class="eyebrow">Recovery phrase</p>
        <div class="reveal-value is-masked" id="reveal-phrase"></div>
        ${button({
          attributes: { id: "reveal-copy-phrase" },
          icon: "copy",
          label: "Copy recovery phrase",
          variant: "ghost",
        })}
        <p class="hint" id="reveal-copy-note">Copying puts the phrase on this device's clipboard, where other apps can read it and it may sync to your other devices. Bramble clears it about a minute after you copy, but cannot clear a clipboard manager's own history.</p>
        <p class="eyebrow">Active account private key${activeIsImported ? " (imported)" : ""}</p>
        <code class="reveal-value is-masked" id="reveal-key"></code>
        ${
          activeIsImported
            ? '<p class="hint" id="reveal-imported-note">This account was imported from a raw key, so the wallet recovery phrase above does not restore it — its private key shown here is its only backup.</p>'
            : ""
        }
        ${button({
          attributes: { id: "reveal-toggle" },
          icon: "check",
          label: "Tap to show",
          variant: "secondary",
        })}
        <p class="hint">Write them down offline. Leaving this screen hides them again.</p>
      </div>
    </section>`,
    )
  );
};

// How long the copied phrase is left on the clipboard before the best-effort
// overwrite. Long enough to paste into a password manager, short enough that a
// forgotten clipboard is not a standing exposure. The overwrite is blind — we
// never read the clipboard, which would need a permission far broader than this
// feature justifies — so it can clobber something copied in the meantime; the
// window is kept short partly for that reason.
const CLIPBOARD_CLEAR_MS = 60_000;

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
  const copyPhrase = deps.app?.querySelector<HTMLButtonElement>("#reveal-copy-phrase");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  // Reading the live node at click time keeps the phrase in exactly one place in
  // the DOM. Putting it in a data attribute — as the shared inline copy control
  // does — would mint a second copy that outlives the mask.
  copyPhrase?.addEventListener("click", () => {
    const phrase = phraseEl?.textContent ?? "";
    const view = copyPhrase.ownerDocument.defaultView;
    const clipboard = view?.navigator.clipboard;
    if (phrase.length === 0 || !clipboard) {
      showToast("Nothing to copy", "error", copyPhrase);
      return;
    }
    void clipboard.writeText(phrase).then(
      () => {
        showToast("Copied — the clipboard is cleared in about a minute", "success", copyPhrase);
        view?.setTimeout(() => {
          void clipboard.writeText("").catch(() => undefined);
        }, CLIPBOARD_CLEAR_MS);
      },
      () => {
        showToast("Copy failed", "error", copyPhrase);
      },
    );
  });

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
        showToast(errorMessage(error, "Reveal failed"), "error", form);
        if (result) {
          result.textContent = errorMessage(error, "Reveal failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};
