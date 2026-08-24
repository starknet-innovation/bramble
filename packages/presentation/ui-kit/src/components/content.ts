/**
 * Shared feedback and data-display templates. All content is plain text and
 * escaped; registered icons are the only markup accepted by this boundary.
 */
import { escapeHtml } from "@mc-wallet/core/html";
import { type ButtonProps, button, type IconButtonProps, iconButton } from "./controls";
import { type UiAttributes, uiAttributes } from "./html-attributes";
import { type IconName, icon } from "./icons";

/**
 * Renders a compact status pill, optionally with an icon or live-status dot.
 */
export const pill = (
  label: string,
  options: {
    readonly dot?: boolean;
    readonly icon?: IconName;
    readonly tone?: "default" | "hardware";
  } = {},
): string => {
  const classes = `pill${options.tone === "hardware" ? " pill-hardware" : ""}`;
  return `<span class="${classes}">${options.dot ? '<span class="dot"></span>' : ""}${options.icon ? icon(options.icon) : ""}${escapeHtml(label)}</span>`;
};

/**
 * Renders a compact non-negative count badge.
 */
export const badge = (count: number): string => {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Badge count must be a non-negative safe integer");
  }
  return `<span class="badge">${count}</span>`;
};

/**
 * Renders a shared quiet empty/degraded state.
 */
export const emptyState = (
  message: string,
  role?: "alert" | "status",
  attributes?: UiAttributes,
): string =>
  `<p class="empty"${role ? ` role="${role}"` : ""}${uiAttributes(attributes)}>${escapeHtml(message)}</p>`;

/**
 * Shared informational callout configuration.
 */
export type CalloutProps = {
  readonly action?: ButtonProps;
  readonly body: string;
  readonly className?: "gate-request";
  readonly icon: IconName;
  readonly role?: "alert" | "note" | "status";
  readonly title: string;
};

/**
 * Renders an escaped informational callout. Actions remain separate controls
 * so callouts never accept arbitrary child HTML.
 */
export const callout = ({
  action,
  body,
  className,
  icon: iconName,
  role = "note",
  title,
}: CalloutProps): string => `
  <section class="callout${className ? ` ${className}` : ""}" role="${role}">
    <span class="callout-icon">${icon(iconName)}</span>
    <span class="callout-copy"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></span>
    ${action ? button(action) : ""}
  </section>`;

/**
 * One label/value fact in a receipt.
 */
export type ReceiptRow = {
  readonly action?: IconButtonProps;
  readonly label: string;
  readonly value: string;
  readonly valueStyle?: "code" | "text";
  readonly valueTone?: "danger" | "default";
};

/**
 * Renders escaped receipt rows for both static receipts and audited live
 * regions whose definition-list container is already mounted.
 */
export const receiptRows = (rows: readonly ReceiptRow[]): string =>
  rows
    .map(
      ({ action, label, value, valueStyle = "text", valueTone = "default" }) =>
        `<div class="receipt-row"><dt>${escapeHtml(label)}</dt><dd${valueTone === "danger" ? ' class="swap-delta-bad"' : ""}>${valueStyle === "code" ? `<code>${escapeHtml(value)}</code>` : escapeHtml(value)}${action ? iconButton(action) : ""}</dd></div>`,
    )
    .join("");

/**
 * Renders an escaped definition-list receipt. Code values use the production
 * mono treatment but never accept preformatted markup.
 */
export const receipt = (rows: readonly ReceiptRow[], attributes?: UiAttributes): string =>
  `<dl class="receipt"${uiAttributes(attributes)}>${receiptRows(rows)}</dl>`;

/**
 * Toast semantic tone.
 */
export type ToastTone = "error" | "success";

/**
 * Renders a static toast specimen with the same structure as the DOM runtime.
 * Runtime behavior (timing, swipe, and copy binding) remains owned by the
 * audited side-panel DOM boundary.
 */
export const toast = (message: string, tone: ToastTone): string =>
  `<div class="toast ${tone}" role="status"><span class="toast-icon">${icon(tone === "success" ? "check" : "alert")}</span><span class="toast-text">${escapeHtml(message)}</span>${tone === "error" ? iconButton({ className: "toast-copy", icon: "copy", label: "Copy error details" }) : ""}</div>`;
