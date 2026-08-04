/**
 * DOM utilities for the side panel: toasts, busy states, scoped status lines,
 * and focus preservation across full re-renders.
 */
import { friendlyNetworkError } from "../shared/network-error";
import { resolveSpring } from "../ui/spring";
import { friendlyError } from "./friendly-error";
import { CREATE_GROUP_PANEL } from "./group-state";
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

/**
 * The visual tone a toast is shown with. Exported as the one source of truth so
 * callers that decide a toast's tone type against it rather than re-declaring
 * the literal union.
 */
export type ToastTone = "error" | "success";

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

// The entrance rides the momentum spring (slight overshoot) so arrival is
// felt, not just seen — a toast that fades in politely goes unnoticed.
const TOAST_SPRING = resolveSpring("momentum");

/**
 * Shows a transient toast in the fixed stack at the bottom of the shell.
 * Anatomy is a fixed scannable heuristic: a leading tone chip (green check /
 * red alert) the eye reads before any text, then the message, then an error's
 * copy control. It springs in with a little momentum, can be swiped away, and
 * error toasts stay longer.
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
  const mark = document.createElement("span");
  mark.className = "toast-icon";
  mark.innerHTML = icon(tone === "error" ? "alert" : "check");
  toast.append(mark);
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

// A data-attribute selector with the value quoted and any embedded quote or
// backslash escaped, so ids that carry a colon (e.g. `networkId:address`) or a
// hyphen (e.g. a slugged group id) select reliably.
const attrSelector = (name: string, value: string): string =>
  `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;

// Any group editor's expander EXCEPT the "Create a group" accordion panel, so a
// focus fallback after a deletion lands on a remaining group rather than the
// create affordance (which sits first in the Groups accordion).
const REAL_GROUP_EXPAND = `[data-group-expand]:not(${attrSelector("data-group-expand", CREATE_GROUP_PANEL)})`;

// Ordered focus candidates for the account-group control the user just acted on.
// Every group mutation repaints the whole shell, so focus must be reclaimed: the
// first selector targets the acted-on control (which survives most mutations —
// e.g. a toggle only flips `aria-pressed`), and the rest are logical successors
// for when the control itself is gone (a deleted group, a healed filter). Icon
// picker options are intentionally omitted: pressing one updates state locally
// without a repaint, so it never loses focus. Returns [] for non-group controls.
const groupControlMemo = (element: HTMLElement): readonly string[] => {
  const data = element.dataset;
  const groupToggle = data["groupToggle"];
  const account = data["account"];
  if (groupToggle !== undefined && account !== undefined) {
    return [
      attrSelector("data-group-toggle", groupToggle) + attrSelector("data-account", account),
      attrSelector("data-assign-toggle", account),
    ];
  }
  const groupPick = data["groupPick"];
  if (groupPick !== undefined && account !== undefined) {
    // The drawer's single-select folder picker: reclaim the acted-on option
    // (it survives the repaint — only `aria-pressed` moves), else the row's
    // picker toggle.
    return [
      attrSelector("data-group-pick", groupPick) + attrSelector("data-account", account),
      attrSelector("data-assign-toggle", account),
    ];
  }
  const assignToggle = data["assignToggle"];
  if (assignToggle !== undefined) {
    return [attrSelector("data-assign-toggle", assignToggle)];
  }
  const removeGroup = data["removeGroup"];
  if (removeGroup !== undefined) {
    // After the confirming tap the group and this button are gone; fall back to
    // that group's edit toggle (still there after only arming), then any other
    // remaining group, then the create panel, then the create form.
    return [
      attrSelector("data-remove-group", removeGroup),
      attrSelector("data-group-expand", removeGroup),
      REAL_GROUP_EXPAND,
      "[data-group-expand]",
      "[data-create-group]",
    ];
  }
  const saveGroup = data["saveGroup"];
  if (saveGroup !== undefined) {
    return [
      attrSelector("data-save-group", saveGroup),
      attrSelector("data-group-expand", saveGroup),
    ];
  }
  const groupExpand = data["groupExpand"];
  if (groupExpand !== undefined) {
    return [
      attrSelector("data-group-expand", groupExpand),
      REAL_GROUP_EXPAND,
      "[data-group-expand]",
    ];
  }
  const groupFilter = data["groupFilter"];
  if (groupFilter !== undefined) {
    // Filtering by a group that is then deleted heals the filter back to "All".
    return [attrSelector("data-group-filter", groupFilter), '[data-group-filter="all"]'];
  }
  if (data["groupName"] !== undefined) {
    // The group name/rename field carries no id or name, so it needs its own
    // selector to be re-focused after a repaint. Scope it to its form: the edit
    // form is keyed by the group id it renames, the create form by its class, so
    // the correct field is reclaimed even when both are on screen.
    const editForm = element.closest("[data-edit-group]");
    const editGroupId = editForm?.getAttribute("data-edit-group");
    return editGroupId
      ? [`${attrSelector("data-edit-group", editGroupId)} [data-group-name]`]
      : [".new-group-form [data-group-name]"];
  }
  if (element.hasAttribute("data-create-group")) {
    return ["[data-create-group]"];
  }
  return [];
};

/**
 * Captures ordered selectors for the focused control before a re-render, most
 * specific first. Group controls contribute successor fallbacks so focus still
 * lands somewhere sensible when the exact control is removed by the mutation.
 * Returns [] when nothing focusable is worth restoring — so a non-user repaint
 * (streaming balances, prices) with no relevant control focused moves nothing.
 */
export const focusMemo = (): readonly string[] => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return [];
  }
  const group = groupControlMemo(active);
  if (group.length > 0) {
    return group;
  }
  if (active.id) {
    return [`#${active.id}`];
  }
  if (isWalletView(active.dataset["view"])) {
    return [`[data-view="${active.dataset["view"]}"]`];
  }
  const name = active.getAttribute("name");
  if (name && FOCUS_NAMES.includes(name)) {
    return [`[name="${name}"]`];
  }
  return [];
};

/**
 * Restores focus after a re-render, trying each memoized selector in order and
 * stopping at the first that resolves to an element that actually takes focus
 * (so a hidden or removed candidate falls through to its successor).
 */
export const restoreFocus = (root: Element | null, selectors: readonly string[]): void => {
  for (const selector of selectors) {
    const element = root?.querySelector<HTMLElement>(selector);
    if (!element) {
      continue;
    }
    element.focus({ preventScroll: true });
    if (document.activeElement === element) {
      return;
    }
  }
};

/**
 * An in-progress edit in the group name/rename field, captured before a repaint.
 * The field is server-rendered (empty for the create form, the stored name for a
 * rename) and torn down by the full-shell swap, so restoring focus alone would
 * still reset it to that server value. `selector` locates the same field after
 * the swap; `value` and the caret offsets re-seed the text the user was typing.
 */
export type GroupNameDraft = {
  readonly selectionEnd: number | null;
  readonly selectionStart: number | null;
  readonly selector: string;
  readonly value: string;
};

/**
 * Captures the focused group-name field's in-progress value and caret before a
 * re-render, or null when no such field is focused. Paired with
 * {@link restoreGroupNameDraft} across the shell swap so a streaming repaint
 * never discards text the user is mid-typing into a new-group or rename field.
 */
export const groupNameDraftMemo = (): GroupNameDraft | null => {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || active.dataset["groupName"] === undefined) {
    return null;
  }
  const [selector] = groupControlMemo(active);
  if (selector === undefined) {
    return null;
  }
  return {
    selectionEnd: active.selectionEnd,
    selectionStart: active.selectionStart,
    selector,
    value: active.value,
  };
};

/**
 * Re-seeds a captured group-name draft into the re-rendered field and restores
 * its caret, so both text and cursor position survive a repaint. A no-op when
 * there is no draft or the field is gone (e.g. the group was deleted).
 */
export const restoreGroupNameDraft = (root: Element | null, draft: GroupNameDraft | null): void => {
  if (!draft) {
    return;
  }
  const input = root?.querySelector<HTMLInputElement>(draft.selector);
  if (!input) {
    return;
  }
  input.value = draft.value;
  if (draft.selectionStart !== null && draft.selectionEnd !== null) {
    input.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  }
};

/**
 * Focus, edit, and scroll state carried across a full-shell DOM swap.
 */
export type RepaintFocus = {
  readonly groupNameDraft: GroupNameDraft | null;
  readonly scrollTop: number;
  readonly selectors: readonly string[];
};
/**
 * Captures interaction state before a shell innerHTML replacement.
 */
export const captureRepaintFocus = (): RepaintFocus => ({
  groupNameDraft: groupNameDraftMemo(),
  scrollTop: document.scrollingElement?.scrollTop ?? document.documentElement.scrollTop,
  selectors: focusMemo(),
});

/**
 * Restores the focus target and re-seeds any captured group-name edit after a
 * shell swap, so neither keyboard focus nor mid-typed text jumps under the user.
 */
export const restoreRepaintFocus = (root: Element | null, focus: RepaintFocus): void => {
  // Replacing the shell can make the document snap to the top before fresh
  // async state lands. Restore position before focus so polling never moves the
  // user's current proposal or account row under their pointer.
  document.documentElement.scrollTop = focus.scrollTop;
  document.body.scrollTop = focus.scrollTop;
  restoreFocus(root, focus.selectors);
  restoreGroupNameDraft(root, focus.groupNameDraft);
};

/**
 * Replaces an element's children with markup parsed as a document fragment — the
 * audited string-HTML sink for panel sub-regions that render their own escaped
 * template (e.g. the Ledger sign overlay) outside the main shell repaint. The
 * caller MUST pass markup whose dynamic text is already escaped (via a pure view
 * template); this performs no sanitisation.
 */
export const renderFragment = (target: Element, markup: string): void => {
  target.replaceChildren(document.createRange().createContextualFragment(markup));
};
