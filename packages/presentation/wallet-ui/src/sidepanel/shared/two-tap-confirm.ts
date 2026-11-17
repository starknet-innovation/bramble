/**
 * Two-tap confirmation for destructive controls (removing an NFT, deleting a
 * folder): the first tap arms the control and says so; only a second tap on
 * the same, still-armed control goes ahead. An armed control disarms itself
 * after a short window, when it loses focus, or on Escape, restoring its
 * original content, accessible name and title, so a much later tap never
 * removes anything by itself.
 *
 * It writes no HTML: the confirm label is set as text, and the original
 * content is restored by moving the saved nodes back.
 */

/** How long an armed control stays armed before it disarms itself. */
export const TWO_TAP_WINDOW_MS = 4_000;

/** How an armed control presents itself. */
export type TwoTapOptions = {
  /** The label announced (and, with `replaceContent`, shown) while armed. */
  readonly label: string;
  /** Show the label in place of the content; icon-only controls keep theirs. */
  readonly replaceContent: boolean;
  /** Overrides the disarm window (tests). */
  readonly windowMs?: number;
};

// Restores an attribute to its saved value, or removes it if it had none.
const restoreAttribute = (control: HTMLElement, name: string, value: string | null): void => {
  if (value === null) control.removeAttribute(name);
  else control.setAttribute(name, value);
};

// Each armed control's disarm, so a confirming tap can disarm it at once.
const disarms = new WeakMap<HTMLButtonElement, () => void>();

/**
 * Returns true when `control` is already armed, and otherwise arms it and
 * returns false. A confirming tap disarms the control before the caller goes
 * ahead, so if the action fails and the control is enabled again, a later tap
 * only arms it again. Disarms after the window, on blur, and on Escape.
 */
export const confirmSecondTap = (button: HTMLButtonElement, options: TwoTapOptions): boolean => {
  // The control this helper owns while it is armed (a local alias, so the
  // writes below do not read as reassigning the caller's argument).
  const control = button;
  if (control.dataset["confirm"] === "true") {
    disarms.get(control)?.();
    return true;
  }
  const content = [...control.childNodes];
  const ariaLabel = control.getAttribute("aria-label");
  const title = control.getAttribute("title");
  const disarm = (): void => {
    clearTimeout(timer);
    control.removeEventListener("blur", disarm);
    control.removeEventListener("keydown", onKey);
    disarms.delete(control);
    if (control.dataset["confirm"] !== "true") return;
    delete control.dataset["confirm"];
    control.classList.remove("is-confirming");
    restoreAttribute(control, "aria-label", ariaLabel);
    restoreAttribute(control, "title", title);
    if (options.replaceContent) control.replaceChildren(...content);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") disarm();
  };
  control.dataset["confirm"] = "true";
  control.classList.add("is-confirming");
  control.setAttribute("aria-label", options.label);
  control.setAttribute("title", options.label);
  if (options.replaceContent) control.replaceChildren(options.label);
  control.addEventListener("blur", disarm);
  control.addEventListener("keydown", onKey);
  const timer = setTimeout(disarm, options.windowMs ?? TWO_TAP_WINDOW_MS);
  disarms.set(control, disarm);
  return false;
};
