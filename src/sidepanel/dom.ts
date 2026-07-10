/**
 * DOM utilities for the side panel: toasts, busy states, scoped status lines,
 * and focus preservation across full re-renders.
 */
import { friendlyNetworkError } from "../shared/network-error";
import { friendlyError } from "./friendly-error";
import { icon } from "./icons";
import { animate } from "./motion";
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

// Slides a toast out along `toX` px (0 = straight fade) and removes it once the
// motion lands. Reduced motion cuts to removal immediately.
const dismissToast = (toast: HTMLElement, toX: number): void => {
  const anim = animate(
    toast,
    [
      { opacity: 1, transform: toast.style.transform || "none" },
      { opacity: 0, transform: `translateX(${toX}px)` },
    ],
    { duration: 200 },
  );
  if (anim) {
    void anim.finished.then(
      () => toast.remove(),
      () => toast.remove(),
    );
    return;
  }
  toast.remove();
};

// Swipe-to-dismiss: the toast tracks the pointer horizontally and flies off when
// released past a distance or with enough flick velocity (> ~0.11 px/ms), so a
// dismissal a user initiated feels direct. A weak swipe springs back to rest.
const bindToastSwipe = (toast: HTMLElement): void => {
  const el = toast;
  let startX = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let dragging = false;
  el.addEventListener("pointerdown", (event: PointerEvent) => {
    // Ignore a second touch point once a swipe is underway — a new origin
    // mid-drag would make the toast jump.
    if (event.button !== 0 || dragging) {
      return;
    }
    for (const running of el.getAnimations()) {
      running.cancel();
    }
    dragging = true;
    startX = event.clientX;
    lastX = event.clientX;
    lastT = event.timeStamp;
    velocity = 0;
    el.setPointerCapture(event.pointerId);
    el.style.transition = "none";
  });
  el.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) {
      return;
    }
    const dx = event.clientX - startX;
    const dt = event.timeStamp - lastT;
    if (dt > 0) {
      velocity = Math.abs(event.clientX - lastX) / dt;
    }
    lastX = event.clientX;
    lastT = event.timeStamp;
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / 220));
  });
  const release = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (el.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId);
    }
    const dx = event.clientX - startX;
    if (velocity > 0.11 || Math.abs(dx) > 80) {
      dismissToast(el, dx >= 0 ? 340 : -340);
      return;
    }
    el.style.opacity = "1";
    const anim = animate(el, [{ transform: `translateX(${dx}px)` }, { transform: "none" }], {
      duration: 200,
    });
    if (!anim) {
      el.style.transform = "";
    }
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
};

/**
 * Shows a transient toast in the fixed stack at the bottom of the shell. It
 * materializes with an interruptible WAAPI spring and can be swiped away; error
 * toasts stay longer and carry a copy control for the message.
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
  animate(
    toast,
    [
      { opacity: 0, transform: "translateY(10px) scale(0.98)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: 240 },
  );
  bindToastSwipe(toast);
  setTimeout(() => dismissToast(toast, 0), tone === "error" ? ERROR_TOAST_MS : SUCCESS_TOAST_MS);
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
      const value = button.dataset["copy"];
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
  if (isWalletView(active.dataset["view"])) {
    return `[data-view="${active.dataset["view"]}"]`;
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
