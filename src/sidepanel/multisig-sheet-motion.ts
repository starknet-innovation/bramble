/** Purposeful open/close motion shared by multisig review sheets. */
import { animate, currentMotionStyle } from "./motion";

type SheetState = "closed" | "closing" | "open" | "opening";

const sheetSerials = new WeakMap<HTMLElement, number>();
const sheetStates = new WeakMap<HTMLElement, SheetState>();
const focusGuardCleanup = new WeakMap<HTMLElement, () => void>();

const focusableIn = (panel: HTMLElement): readonly HTMLElement[] =>
  [
    ...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), summary, textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])',
    ),
  ].filter(
    (element) => !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true",
  );

const deactivateFocusGuard = (panel: HTMLElement): void => {
  focusGuardCleanup.get(panel)?.();
  focusGuardCleanup.delete(panel);
};

const activateFocusGuard = (panel: HTMLElement): void => {
  deactivateFocusGuard(panel);
  const ownerDocument = panel.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) return;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const focusable = focusableIn(panel);
    const first = focusable[0] ?? panel;
    const last = focusable.at(-1) ?? panel;
    const active = ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (
      panel.hidden ||
      (event.target instanceof ownerWindow.Node && panel.contains(event.target))
    ) {
      return;
    }
    (focusableIn(panel)[0] ?? panel).focus({ preventScroll: true });
  };
  panel.addEventListener("keydown", onKeyDown);
  ownerDocument.addEventListener("focusin", onFocusIn);
  focusGuardCleanup.set(panel, () => {
    panel.removeEventListener("keydown", onKeyDown);
    ownerDocument.removeEventListener("focusin", onFocusIn);
  });
};

const nextSheetSerial = (panel: HTMLElement): number => {
  const serial = (sheetSerials.get(panel) ?? 0) + 1;
  sheetSerials.set(panel, serial);
  return serial;
};

const finished = (animations: readonly (Animation | null)[]): Promise<void> =>
  Promise.all(
    animations.flatMap((animation) =>
      animation ? [animation.finished.catch(() => undefined)] : [],
    ),
  ).then(() => undefined);

const cardIn = (panel: HTMLElement, resume: boolean): Animation | null => {
  const card = panel.querySelector<HTMLElement>(".multisig-review-card");
  if (!card) return null;
  const from = resume ? currentMotionStyle(card, "transform") : "translateY(8px) scale(0.98)";
  card.style.willChange = "transform";
  const motion = animate(card, [{ transform: from }, { transform: "translateY(0) scale(1)" }], {
    duration: 220,
    id: "multisig-sheet-card",
  });
  return motion;
};

/**
 * Opens a centered review sheet and moves focus into its primary context.
 */
export const openMultisigSheet = (panel: HTMLElement, focusTarget?: HTMLElement | null): void => {
  const previousState = sheetStates.get(panel) ?? (panel.hidden ? "closed" : "open");
  const resume = previousState === "closing";
  const serial = nextSheetSerial(panel);
  sheetStates.set(panel, "opening");
  const target = panel;
  target.hidden = false;
  activateFocusGuard(target);
  target.style.willChange = "opacity";
  const overlay = animate(
    target,
    [{ opacity: resume ? currentMotionStyle(target, "opacity") : 0 }, { opacity: 1 }],
    {
      duration: 160,
      id: "multisig-sheet-overlay",
    },
  );
  const card = cardIn(target, resume);
  void finished([overlay, card]).then(() => {
    if (sheetSerials.get(target) !== serial) return;
    sheetStates.set(target, "open");
    target.style.willChange = "";
    const cardElement = target.querySelector<HTMLElement>(".multisig-review-card");
    if (cardElement) cardElement.style.willChange = "";
  });
  (focusTarget ?? focusableIn(target)[0] ?? target).focus({ preventScroll: true });
};

/**
 * Closes a review sheet quickly, then restores focus to its invoking control.
 */
export const closeMultisigSheet = (panel: HTMLElement, restoreFocus?: HTMLElement | null): void => {
  if (panel.hidden || sheetStates.get(panel) === "closing") return;
  deactivateFocusGuard(panel);
  const serial = nextSheetSerial(panel);
  sheetStates.set(panel, "closing");
  const target = panel;
  const card = target.querySelector<HTMLElement>(".multisig-review-card");
  target.style.willChange = "opacity";
  if (card) card.style.willChange = "transform";
  const overlay = animate(
    target,
    [{ opacity: currentMotionStyle(target, "opacity") || 1 }, { opacity: 0 }],
    {
      duration: 120,
      id: "multisig-sheet-overlay",
    },
  );
  const cardMotion = card
    ? animate(
        card,
        [
          { transform: currentMotionStyle(card, "transform") || "translateY(0) scale(1)" },
          { transform: "translateY(5px) scale(0.985)" },
        ],
        { duration: 120, id: "multisig-sheet-card" },
      )
    : null;
  void finished([overlay, cardMotion]).then(() => {
    if (sheetSerials.get(target) !== serial) return;
    sheetStates.set(target, "closed");
    target.hidden = true;
    target.style.willChange = "";
    if (card) card.style.willChange = "";
    restoreFocus?.focus({ preventScroll: true });
  });
};
