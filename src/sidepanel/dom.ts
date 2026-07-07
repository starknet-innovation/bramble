/**
 * DOM utilities for the side panel: toasts, busy states, scoped status lines,
 * and focus preservation across full re-renders.
 */
import { icon } from "./icons";
import { isWalletView } from "./parts";

/**
 * Formats an error for user-facing status lines.
 */
export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

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
 * Writes a message to the nearest section status line.
 */
export const scopedStatus = (element: Element, message: string): void => {
  const target = element.closest(".section")?.querySelector<HTMLElement>('[role="status"]');
  if (target) {
    target.textContent = message;
  }
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
 * Shows a transient toast in the fixed stack at the bottom of the shell.
 * Error toasts stay longer and carry a copy control for the message.
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

  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  toast.append(text);
  if (tone === "error") {
    toast.append(toastCopyButton(message));
  }
  stack.append(toast);
  setTimeout(() => toast.remove(), tone === "error" ? ERROR_TOAST_MS : SUCCESS_TOAST_MS);
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
