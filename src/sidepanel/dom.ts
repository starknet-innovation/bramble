/**
 * DOM utilities for the side panel: toasts, busy states, scoped status lines,
 * and focus preservation across full re-renders.
 */
import { friendlyNetworkError } from "../shared/network-error";
import { friendlyError } from "./friendly-error";
import { icon } from "./icons";
import { isWalletView } from "./parts";

/**
 * Formats an error for user-facing status lines, rewriting raw transport
 * failures (e.g. "Failed to fetch") into a friendly, actionable line.
 */
export const errorMessage = (error: unknown, fallback: string): string => {
  const raw = error instanceof Error ? error.message : fallback;
  return friendlyNetworkError(raw) ?? raw;
};

/**
 * Marks a button busy so repeated submits are impossible while work runs.
 */
export const buttonBusy = (button: HTMLButtonElement | null | undefined, busy: boolean): void => {
  if (!button) {
    return;
  }
  const target = button;
  target.disabled = busy;
  target.toggleAttribute("data-busy", busy);
};

/**
 * Writes a message to the nearest section status line. Returns whether a
 * status line existed, so callers can fall back to a toast when the control
 * lives outside any announced section.
 */
export const scopedStatus = (element: Element, message: string): boolean => {
  const target = element.closest(".section")?.querySelector<HTMLElement>('[role="status"]');
  if (target) {
    target.textContent = message;
    return true;
  }
  return false;
};

type ToastTone = "error" | "success";

const SUCCESS_TOAST_MS = 3200;
const ERROR_TOAST_MS = 8000;

const toastCopyButton = (message: string): HTMLButtonElement => {
  const copy = document.createElement("button");
  copy.className = "icon-button toast-copy";
  copy.type = "button";
  copy.setAttribute("aria-label", "Copy error message");
  copy.title = "Copy error message";
  copy.innerHTML = icon("copy");
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(message).then(
      () => {
        copy.innerHTML = icon("check");
      },
      () => undefined,
    );
  });
  return copy;
};

/**
 * Shows a transient toast in the fixed stack at the bottom of the shell. Error
 * toasts stay longer and are rewritten to friendly, user-facing copy; a
 * copy-to-clipboard control is attached only for genuinely unexpected internal
 * errors, never for validation or other recoverable user-facing conditions.
 */
export const showToast = (message: string, tone: ToastTone): void => {
  const stackId = "toast-stack";
  const stack = document.querySelector<HTMLElement>(`#${stackId}`) ?? document.createElement("div");
  if (!stack.id) {
    stack.id = stackId;
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    document.body.append(stack);
  }

  const friendly = tone === "error" ? friendlyError(message) : null;
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = friendly ? friendly.message : message;
  toast.append(text);
  if (friendly?.copyable) {
    toast.append(toastCopyButton(friendly.message));
  }
  stack.append(toast);
  setTimeout(() => toast.remove(), tone === "error" ? ERROR_TOAST_MS : SUCCESS_TOAST_MS);
};

// Swaps the button's copy glyph for a check while the confirmation lands,
// then restores it unless a re-render already replaced the control.
const confirmCopyGlyph = (button: HTMLButtonElement): void => {
  const glyph = button.querySelector("svg");
  if (!glyph) {
    return;
  }
  glyph.outerHTML = icon("check");
  button.classList.add("copy-confirm");
  setTimeout(() => {
    if (!button.isConnected) {
      return;
    }
    const check = button.querySelector("svg");
    if (check) {
      check.outerHTML = icon("copy");
    }
    button.classList.remove("copy-confirm");
  }, 1400);
};

/**
 * Binds every `[data-copy]` control under the app root to the clipboard with
 * scoped-status or toast feedback and a transient check glyph.
 */
export const bindCopyButtons = (app: Element | null): void => {
  app?.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.copy;
      if (!value) {
        return;
      }
      buttonBusy(button, true);
      void navigator.clipboard.writeText(value).then(
        () => {
          if (!scopedStatus(button, "Copied")) {
            showToast("Copied", "success");
          }
          buttonBusy(button, false);
          confirmCopyGlyph(button);
        },
        () => {
          scopedStatus(button, "Copy failed");
          showToast("Copy failed", "error");
          buttonBusy(button, false);
        },
      );
    });
  });
};

const FOCUS_NAMES = ["address", "amount", "label", "mnemonic", "recipient", "vaultPassphrase"];

/**
 * Captures a selector for the focused control before a re-render.
 */
export const focusMemo = (): string | null => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return null;
  }
  if (active.id) {
    return `#${active.id}`;
  }
  if (isWalletView(active.dataset.view)) {
    return `[data-view="${active.dataset.view}"]`;
  }
  const name = active.getAttribute("name");
  if (name && FOCUS_NAMES.includes(name)) {
    return `[name="${name}"]`;
  }
  return null;
};

/**
 * Restores focus to the equivalent control after a re-render.
 */
export const restoreFocus = (root: Element | null, selector: string | null): void => {
  if (!selector) {
    return;
  }
  root?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
};
