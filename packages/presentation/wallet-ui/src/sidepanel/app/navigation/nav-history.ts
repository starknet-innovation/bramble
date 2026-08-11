/**
 * Pure back-stack model for the side panel's screen history. The shell has no
 * URL router, so navigation pushes the screen being left onto this stack and
 * Back pops to the true previous screen. That makes Back correct for a view
 * reached from more than one place — the account screen, for instance, opened
 * from the Home drawer returns to Home, while the same screen opened from the
 * Settings menu returns to Settings — without any per-screen static back target
 * (which is why it also subsumes the multisig-propose per-entry workaround).
 * Kept pure and DOM-free so the entrypoint holds only the array and the effects.
 */
import type { WalletView } from "../../shared/parts";

/**
 * The screen Back can never pop past: with an empty stack, Back stays at Home.
 */
export const ROOT_VIEW: WalletView = "home";

// Bound on retained history so a long session cannot grow it without limit;
// dropping the oldest entries only affects Back many screens deep.
const MAX_DEPTH = 50;

/**
 * The stack of screens to return to, oldest first; the last entry is where the
 * next Back lands.
 */
export type ViewHistory = readonly WalletView[];

/**
 * Records `leaving` as the screen a later Back should return to. Consecutive
 * duplicates collapse, so repeated navigations to the same screen never stack,
 * and the history is capped at {@link MAX_DEPTH}.
 */
export const pushView = (history: ViewHistory, leaving: WalletView): ViewHistory => {
  if (history[history.length - 1] === leaving) {
    return history;
  }
  const next = [...history, leaving];
  return next.length > MAX_DEPTH ? next.slice(next.length - MAX_DEPTH) : next;
};

/**
 * Pops the most recent screen to return to, yielding that view and the trimmed
 * history. On an empty stack it returns {@link ROOT_VIEW} and the unchanged
 * (empty) history, so Back can never escape past the first screen.
 */
export const popView = (
  history: ViewHistory,
): { readonly view: WalletView; readonly history: ViewHistory } =>
  history.length === 0
    ? { history, view: ROOT_VIEW }
    : { history: history.slice(0, -1), view: history[history.length - 1] as WalletView };
