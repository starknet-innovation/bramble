/**
 * Focus and in-progress-edit preservation across full-shell repaints. The panel
 * replaces its entire DOM on every paint, so keyboard focus and a half-typed
 * group name must be captured before the swap and re-seeded after it; without
 * this the caret jumps out from under the user mid-edit. Split from ./dom.ts,
 * which owns the remaining transient-feedback utilities.
 */
import { CREATE_GROUP_PANEL } from "../../journeys/settings/group-state";
import { isWalletView } from "../../shared/parts";

const FOCUS_NAMES = ["address", "amount", "label", "mnemonic", "recipient", "vaultPassphrase"];
const REPAINT_DRAFT_NAMES = new Set([
  "address",
  "amount",
  "calldata",
  "contractAddress",
  "deploymentSalt",
  "discoveryUrl",
  "entrypoint",
  "feeToken",
  "folderName",
  "indexerUrl",
  "intentPackage",
  "label",
  "name",
  "ohttpRelayUrl",
  "paymasterUrl",
  "poolAddress",
  "proverUrl",
  "recipient",
  "rpcUrl",
  "salt",
  "signature",
  "signerPublicKeys",
  "subaccountAnonymizerAddress",
  "threshold",
  "tokenId",
]);

// A data-attribute selector with the value quoted and any embedded quote or
// backslash escaped, so ids that carry a colon (e.g. `networkId:address`) or a
// hyphen (e.g. a slugged group id) select reliably.
const attrSelector = (name: string, value: string): string =>
  `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;

// Any group editor's expander EXCEPT the "Create a folder" accordion panel, so a
// focus fallback after a deletion lands on a remaining group rather than the
// create affordance (which sits first in the Groups accordion).
const REAL_GROUP_EXPAND = `[data-group-expand]:not(${attrSelector("data-group-expand", CREATE_GROUP_PANEL)})`;

// Ordered focus candidates for the account-group control the user just acted on.
// Every group mutation repaints the whole shell, so focus must be reclaimed: the
// first selector targets the acted-on control (which survives most mutations —
// e.g. a toggle only flips `aria-pressed`), and the rest are logical successors
// for when the control itself is gone (a deleted group). Icon
// picker options are intentionally omitted: pressing one updates state locally
// without a repaint, so it never loses focus. Returns [] for non-group controls.
const groupControlMemo = (element: HTMLElement): readonly string[] => {
  const data = element.dataset;
  const groupToggle = data["groupToggle"];
  const account = data["account"];
  if (groupToggle !== undefined && account !== undefined) {
    return [attrSelector("data-group-toggle", groupToggle) + attrSelector("data-account", account)];
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
export const focusMemo = (doc: Document = document): readonly string[] => {
  const active = doc.activeElement;
  const ElementType = doc.defaultView?.HTMLElement;
  if (!ElementType || !(active instanceof ElementType)) {
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
  if (name && (FOCUS_NAMES.includes(name) || REPAINT_DRAFT_NAMES.has(name))) {
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
  const doc = root?.ownerDocument ?? document;
  for (const selector of selectors) {
    const element = root?.querySelector<HTMLElement>(selector);
    if (!element) {
      continue;
    }
    element.focus({ preventScroll: true });
    if (doc.activeElement === element) {
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
type GroupNameDraft = {
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
const groupNameDraftMemo = (doc: Document): GroupNameDraft | null => {
  const active = doc.activeElement;
  const InputType = doc.defaultView?.HTMLInputElement;
  if (!InputType || !(active instanceof InputType) || active.dataset["groupName"] === undefined) {
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
const restoreGroupNameDraft = (root: Element | null, draft: GroupNameDraft | null): void => {
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

type ActiveDraft = {
  readonly selectionEnd: number | null;
  readonly selectionStart: number | null;
  readonly selector: string;
  readonly value: string;
};

// Only explicitly non-secret fields may cross a shell swap. Recovery phrases,
// vault passphrases, imported keys, and file inputs are intentionally absent.
const activeDraftMemo = (doc: Document): ActiveDraft | null => {
  const active = doc.activeElement;
  const view = doc.defaultView;
  if (
    !view ||
    !(
      active instanceof view.HTMLInputElement ||
      active instanceof view.HTMLTextAreaElement ||
      active instanceof view.HTMLSelectElement
    )
  ) {
    return null;
  }
  const name = active.getAttribute("name");
  if (!name || !REPAINT_DRAFT_NAMES.has(name)) {
    return null;
  }
  const [selector] = focusMemo(doc);
  if (!selector) {
    return null;
  }
  return {
    selectionEnd: active instanceof view.HTMLSelectElement ? null : active.selectionEnd,
    selectionStart: active instanceof view.HTMLSelectElement ? null : active.selectionStart,
    selector,
    value: active.value,
  };
};

const restoreActiveDraft = (root: Element | null, draft: ActiveDraft | null): void => {
  if (!draft) {
    return;
  }
  const field = root?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    draft.selector,
  );
  if (!field) {
    return;
  }
  field.value = draft.value;
  if (
    !(field instanceof HTMLSelectElement) &&
    draft.selectionStart !== null &&
    draft.selectionEnd !== null
  ) {
    field.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  }
};

/**
 * Everything a full-shell repaint must carry across the DOM swap: the ordered
 * focus selectors and, when a group-name field is being edited, its in-progress
 * value and caret. Bundled so the paint loop captures and restores both in one
 * step rather than juggling the two concerns at the call site.
 */
export type RepaintFocus = {
  readonly activeDraft: ActiveDraft | null;
  readonly groupNameDraft: GroupNameDraft | null;
  readonly scrollTop: number;
  readonly selectors: readonly string[];
};

/**
 * Captures the focus target and any in-progress group-name edit before a shell
 * swap. Pair with {@link restoreRepaintFocus} around the innerHTML replacement.
 */
export const captureRepaintFocus = (root: Element | null = null): RepaintFocus => {
  const doc = root?.ownerDocument ?? document;
  return {
    activeDraft: activeDraftMemo(doc),
    groupNameDraft: groupNameDraftMemo(doc),
    scrollTop: doc.scrollingElement?.scrollTop ?? doc.documentElement.scrollTop,
    selectors: focusMemo(doc),
  };
};

/**
 * Restores the focus target and re-seeds any captured group-name edit after a
 * shell swap, so neither keyboard focus nor mid-typed text jumps under the user.
 */
export const restoreRepaintFocus = (root: Element | null, focus: RepaintFocus): void => {
  const doc = root?.ownerDocument ?? document;
  // Replacing the shell can make the document snap to the top before fresh
  // async state lands. Restore position before focus so polling never moves the
  // user's current proposal or account row under their pointer.
  doc.documentElement.scrollTop = focus.scrollTop;
  doc.body.scrollTop = focus.scrollTop;
  restoreFocus(root, focus.selectors);
  restoreGroupNameDraft(root, focus.groupNameDraft);
  restoreActiveDraft(root, focus.activeDraft);
};
