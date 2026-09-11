/**
 * DOM utilities for the side panel: toasts, busy states, scoped status lines,
 * and the audited fragment sink. Focus preservation across repaints lives in
 * ./focus-memo.
 */
import { friendlyNetworkError } from "@bramble/core/network-error";
import { resolveSpring } from "@bramble/ui-kit/spring";
import { friendlyError } from "../runtime/friendly-error";
import { icon } from "./icons";
import { animate } from "./motion";

/**
 * Formats an error for user-facing status lines, rewriting raw transport
 * failures (e.g. "Failed to fetch") into a friendly, actionable line.
 */
export const errorMessage = (error: unknown, fallback: string): string => {
  const raw = errorDetails(error, fallback);
  return friendlyNetworkError(raw) ?? raw;
};

/** Complete safe diagnostic carried by an Error for an explicit user copy action. */
export const errorDetails = (error: unknown, fallback: string): string =>
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
 * Writes a message to the nearest section status line. Returns whether a
 * status line existed, so callers can fall back to a toast when the control
 * lives outside any announced section. Only a text line (`p`/`span` with
 * `role="status"`) is a sink: outcome and working stages are live-region
 * containers that also carry the role, and writing into one would replace its
 * markup.
 */
export const scopedStatus = (element: Element, message: string): boolean => {
  const target = element
    .closest(".section")
    ?.querySelector<HTMLElement>('p[role="status"], span[role="status"]');
  if (target) {
    target.textContent = message;
    return true;
  }
  return false;
};

/**
 * The visual tone a toast is shown with. Exported as the one source of truth so
 * callers that decide a toast's tone type against it rather than re-declaring
 * the literal union.
 */
export type ToastTone = "error" | "success";

const SUCCESS_TOAST_MS = 3200;
const ERROR_TOAST_MS = 8000;

const documentFor = (context?: Document | Element | null): Document =>
  context ? ("defaultView" in context ? context : context.ownerDocument) : document;

const toastCopyButton = (doc: Document, message: string): HTMLButtonElement => {
  const copy = doc.createElement("button");
  copy.className = "icon-button toast-copy";
  copy.type = "button";
  copy.setAttribute("aria-label", "Copy error details");
  copy.title = "Copy error details";
  copy.innerHTML = icon("copy");
  copy.addEventListener("click", () => {
    const clipboard = copy.ownerDocument.defaultView?.navigator.clipboard;
    void (clipboard?.writeText(message) ?? Promise.reject(new Error("Clipboard unavailable"))).then(
      () => {
        copy.innerHTML = icon("check");
        copy.title = "Error details copied";
        copy.setAttribute("aria-label", "Error details copied");
      },
      () => {
        // Never raise another toast from inside a toast; say it in place instead
        // of failing silently, which reads as a dead control.
        copy.title = "Copy failed";
        copy.setAttribute("aria-label", "Copy failed");
      },
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
    // mid-drag would make the toast jump. Also never capture a press that
    // started on a control inside the toast: pointer capture retargets the
    // click to the toast, so swiping would swallow the copy button's own click.
    if (
      event.button !== 0 ||
      dragging ||
      (event.target instanceof Element && event.target.closest("button") !== null)
    ) {
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

// The entrance rides the momentum spring (slight overshoot) so arrival is
// felt, not just seen — a toast that fades in politely goes unnoticed.
const TOAST_SPRING = resolveSpring("momentum");

/**
 * Shows a transient toast in the fixed stack at the bottom of the shell.
 * Anatomy is a fixed scannable heuristic: a leading tone chip (green check /
 * red alert) the eye reads before any text, then the message, then every
 * error's copy control. It springs in with a little momentum, can be swiped
 * away, and error toasts stay longer. `details` lets a compact display line
 * retain the complete diagnostic behind its copy control.
 */
export const showToast = (
  message: string,
  tone: ToastTone,
  context: Document | Element | null | undefined,
  details: string = message,
): void => {
  const doc = documentFor(context);
  const stackId = "toast-stack";
  const stack = doc.querySelector<HTMLElement>(`#${stackId}`) ?? doc.createElement("div");
  if (!stack.id) {
    stack.id = stackId;
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    doc.body.append(stack);
  }

  const friendly = tone === "error" ? friendlyError(message) : null;
  const toast = doc.createElement("div");
  toast.className = `toast ${tone}`;
  const mark = doc.createElement("span");
  mark.className = "toast-icon";
  mark.innerHTML = icon(tone === "error" ? "alert" : "check");
  toast.append(mark);
  const text = doc.createElement("span");
  text.className = "toast-text";
  text.textContent = friendly ? friendly.message : message;
  toast.append(text);
  if (tone === "error") {
    toast.append(toastCopyButton(doc, details));
  }
  stack.append(toast);
  animate(
    toast,
    [
      { opacity: 0, transform: "translateY(18px) scale(0.95)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: TOAST_SPRING.durationMs, easing: TOAST_SPRING.easing },
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
      const clipboard = button.ownerDocument.defaultView?.navigator.clipboard;
      void (clipboard?.writeText(value) ?? Promise.reject(new Error("Clipboard unavailable"))).then(
        () => {
          if (!scopedStatus(button, "Copied")) {
            showToast("Copied", "success", button);
          }
          buttonBusy(button, false);
          confirmCopyGlyph(button);
        },
        () => {
          scopedStatus(button, "Copy failed");
          showToast("Copy failed", "error", button);
          buttonBusy(button, false);
        },
      );
    });
  });
};

/**
 * Replaces an element's children with markup parsed as a document fragment — the
 * audited string-HTML sink for panel sub-regions that render their own escaped
 * template (e.g. the Ledger sign overlay) outside the main shell repaint. The
 * caller MUST pass markup whose dynamic text is already escaped (via a pure view
 * template); this performs no sanitisation.
 */
export const renderFragment = (target: Element, markup: string): void => {
  target.replaceChildren(target.ownerDocument.createRange().createContextualFragment(markup));
};
