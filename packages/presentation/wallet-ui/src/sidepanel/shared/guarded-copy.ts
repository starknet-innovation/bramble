/**
 * Guarded clipboard copy for text the user must keep secret — the recovery
 * phrase on the Reveal screen and on the onboarding "Save your recovery
 * phrase" step. One implementation, so both places warn, copy, and clear the
 * same way.
 *
 * Copying is a deliberate widening of where the secret can live: the clipboard
 * is readable by every application on the machine and may sync between
 * devices. So a caller offers the control only after a deliberate reveal, shows
 * {@link GUARDED_COPY_NOTE} beside it, and every copy schedules a best-effort
 * overwrite. Best-effort is the honest word: the panel can be closed before the
 * timer fires, and a clipboard manager's own history is beyond reach.
 */
import { showToast } from "./dom";

/**
 * How long the copied text is left on the clipboard before the best-effort
 * overwrite. Long enough to paste into a password manager, short enough that a
 * forgotten clipboard is not a standing exposure. The overwrite is blind — the
 * clipboard is never read, which would need a permission far broader than this
 * feature justifies — so it can clobber something copied in the meantime; the
 * window is kept short partly for that reason.
 */
export const GUARDED_COPY_CLEAR_MS = 60_000;

/**
 * What the user accepts by copying, shown beside every guarded copy control.
 */
export const GUARDED_COPY_NOTE =
  "Copying puts the phrase on this device's clipboard, where other apps can read it and it may sync to your other devices. Bramble clears it about a minute after you copy, but cannot clear a clipboard manager's own history.";

/**
 * Binds a guarded copy to `button`. `read` is called at click time and must
 * return the live text (never a copy kept in markup or a data attribute); an
 * empty string means there is nothing the user has revealed to copy, which is
 * reported rather than silently ignored. A missing button is a no-op, and a
 * clipboard that rejects the write is reported as a failed copy.
 */
export const bindGuardedCopy = (button: HTMLButtonElement | null, read: () => string): void => {
  button?.addEventListener("click", () => {
    const text = read();
    const view = button.ownerDocument.defaultView;
    const clipboard = view?.navigator.clipboard;
    if (text.length === 0 || !clipboard) {
      showToast("Nothing to copy", "error", button);
      return;
    }
    void clipboard.writeText(text).then(
      () => {
        showToast("Copied — the clipboard is cleared in about a minute", "success", button);
        view?.setTimeout(() => {
          void clipboard.writeText("").catch(() => undefined);
        }, GUARDED_COPY_CLEAR_MS);
      },
      () => {
        showToast("Copy failed", "error", button);
      },
    );
  });
};
