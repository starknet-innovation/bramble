/**
 * The show/hide control on a passphrase being created.
 *
 * Someone choosing a passphrase they cannot see has to type it twice from
 * memory and gets no help from the strength meter beside it, so the field
 * offers to show it. Only creation screens do: on unlock, an unmasked field
 * puts an existing credential on screen for nothing, since the reader already
 * knows what they typed and is one field from finding out whether it was right.
 *
 * Starts hidden and never remembers being shown, so a repaint, a step back, or
 * a second visit cannot leave the value exposed behind a screen the reader is
 * no longer looking at. Pure DOM; the value is read and written by the browser
 * alone and never touched here.
 */
import { renderFragment } from "../../shared/dom";
import { icon } from "../../shared/icons";

const SHOW = "Show passphrase";
const HIDE = "Hide passphrase";

// Bound controls, tracked the way the shared copy binding tracks its own: the
// binder runs on every paint and a second listener would toggle twice per
// click, masking the field again the instant it was shown.
const bound = new WeakSet<HTMLButtonElement>();

/**
 * Binds every reveal control inside `root`. Safe to call on every paint: a
 * control already bound is skipped, and each one re-masks its own field so a
 * newly mounted form never inherits a revealed state.
 */
export const bindPassphraseReveal = (root: ParentNode | null | undefined): void => {
  root?.querySelectorAll<HTMLButtonElement>("[data-passphrase-reveal]").forEach((control) => {
    const input = control.closest("label")?.querySelector<HTMLInputElement>("input");
    if (!input) {
      return;
    }
    input.type = "password";
    if (bound.has(control)) {
      return;
    }
    bound.add(control);
    control.addEventListener("click", () => {
      const shown = input.type === "text";
      input.type = shown ? "password" : "text";
      const label = shown ? SHOW : HIDE;
      control.setAttribute("aria-label", label);
      control.setAttribute("title", label);
      control.setAttribute("aria-pressed", String(!shown));
      renderFragment(control, icon(shown ? "eye" : "eyeOff"));
      // Typing continues where it left off rather than at the end of the value.
      input.focus();
    });
  });
};
