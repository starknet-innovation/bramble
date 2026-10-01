/**
 * Guarded clipboard copy for text the user must keep secret — the recovery
 * phrase on the Reveal screen and on the onboarding "Save your recovery
 * phrase" step. One implementation, so both places warn, copy, and clear the
 * same way.
 *
 * Copying is a deliberate widening of where the secret can live: the clipboard
 * is readable by every application on the machine and may sync between
 * devices. So a caller offers the control only after a deliberate reveal, says
 * so ({@link guardedCopyNote} on Reveal), and every copy schedules a best-effort
 * overwrite. Best-effort is the honest word: the user can still close the
 * panel or tab before the timer fires, and a clipboard manager's own history
 * is beyond reach. The onboarding completion handoff must not be that close:
 * it goes through {@link closeAfterGuardedClear}, because shutting the page
 * cancels the timer and would leave the phrase on the clipboard.
 *
 * The overwrite runs a minute after the click, with no user activation. The
 * manifest does not request `clipboardWrite`, and Firefox refuses such a write
 * from an extension page, so there the wallet never promises a clear (see
 * {@link guardedCopyCanClear}). Anywhere a clear is attempted and refused, the
 * user is told and the refusal is never reported as a successful clear.
 */
import { showToast } from "./dom";

/**
 * Resolves once the latest scheduled overwrite has been attempted: `true` when
 * it cleared the clipboard (or nothing was scheduled), `false` when refused.
 */
let pendingClear: Promise<boolean> = Promise.resolve(true);
let clearGeneration = 0;
let clearPending = false;

/**
 * Resolves when the latest guarded-copy overwrite has been attempted, with
 * whether it actually cleared the clipboard. Already `true` when nothing was
 * scheduled. A clear superseded by a newer copy resolves with the newer one's
 * outcome. The copied text never leaves the page that wrote it.
 */
export const guardedCopyPendingClear = (): Promise<boolean> => pendingClear;

/**
 * Whether a clipboard overwrite is still scheduled. The completion screen uses
 * this to explain why its tab has not closed yet.
 */
export const guardedCopyClearIsPending = (): boolean => clearPending;

/**
 * Drops a pending clear so a later test does not wait on a timer this process
 * will never run. Production code does not call it.
 */
export const resetGuardedCopyClearForTests = (): void => {
  clearGeneration += 1;
  clearPending = false;
  pendingClear = Promise.resolve(true);
};

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
 * What the user accepts by copying, shown beside a guarded copy control where
 * the wallet can clear the clipboard afterwards.
 */
export const GUARDED_COPY_NOTE =
  "Other apps can read the clipboard, and it may sync to your other devices. Bramble clears it after about a minute, but not from clipboard history.";

/**
 * The same warning where the wallet cannot clear the clipboard (Firefox): it
 * says so instead of promising an overwrite that will be refused.
 */
export const GUARDED_COPY_NOTE_NO_CLEAR =
  "Other apps can read the clipboard, and it may sync to your other devices. Bramble cannot clear it in this browser, so copy something else afterwards.";

const CLEAR_FAILED = "Couldn't clear the clipboard. Copy something else to overwrite it.";

/**
 * Whether this page can overwrite the clipboard a minute after the copy.
 * Firefox extension pages (`moz-extension:`) cannot without `clipboardWrite`,
 * which Bramble does not request, so they get no clear and no promise of one.
 * A page without a window cannot schedule one either.
 */
const guardedCopyCanClear = (view: Window | null | undefined): view is Window =>
  view != null && view.location.protocol !== "moz-extension:";

/**
 * The clipboard warning that is true for the page `view` belongs to.
 */
export const guardedCopyNote = (view: Window | null | undefined): string =>
  guardedCopyCanClear(view) ? GUARDED_COPY_NOTE : GUARDED_COPY_NOTE_NO_CLEAR;

/**
 * Closes the onboarding page once the latest clipboard clear has run, saying
 * on `status` why it is still open meanwhile. A refused clear keeps the page
 * open and tells the user to overwrite the clipboard themselves, rather than
 * closing as if the phrase were gone.
 */
export const closeAfterGuardedClear = (status: HTMLElement | null, close: () => void): void => {
  const target = status;
  if (clearPending && target) {
    target.textContent =
      "Opening the wallet… This tab stays open until the clipboard clear finishes.";
  }
  void pendingClear.then((cleared) => {
    if (cleared) {
      close();
    } else if (target) {
      target.textContent = `${CLEAR_FAILED} Then close this tab.`;
    }
  });
};

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
        if (!guardedCopyCanClear(view)) {
          showToast("Copied — copy something else afterwards to overwrite it", "success", button);
          return;
        }
        showToast("Copied — the clipboard is cleared in about a minute", "success", button);
        const generation = ++clearGeneration;
        clearPending = true;
        pendingClear = new Promise((resolve) => {
          view.setTimeout(() => {
            // A newer copy owns the clipboard and its own clear; writing now
            // would empty what the user just copied.
            if (generation !== clearGeneration) {
              resolve(pendingClear);
              return;
            }
            const finish = (cleared: boolean): void => {
              if (generation === clearGeneration) {
                clearPending = false;
              }
              if (!cleared) {
                showToast(CLEAR_FAILED, "error", button);
              }
              resolve(cleared);
            };
            void clipboard.writeText("").then(
              () => finish(true),
              () => finish(false),
            );
          }, GUARDED_COPY_CLEAR_MS);
        });
      },
      () => {
        showToast("Copy failed", "error", button);
      },
    );
  });
};
