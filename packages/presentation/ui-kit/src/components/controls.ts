/**
 * Shared, escaped control renderers. These templates are the authoritative
 * button/link vocabulary for production wallet surfaces and Storybook.
 */
import { escapeHtml } from "@mc-wallet/core/html";
import { type UiAttributes, uiAttributes, uiClassNames } from "./html-attributes";
import { type IconName, icon } from "./icons";

/**
 * Visual button hierarchy. Danger is a semantic tone and can be combined with
 * the neutral secondary treatment through `tone`.
 */
export type ButtonVariant = "ghost" | "primary" | "secondary";

/**
 * Shared text-button configuration.
 */
export type ButtonProps = {
  readonly attributes?: UiAttributes;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly icon?: IconName;
  readonly iconPosition?: "after" | "before";
  readonly label: string;
  readonly size?: "default" | "small";
  readonly tone?: "danger" | "default";
  readonly type?: "button" | "submit";
  readonly variant?: ButtonVariant;
};

const controlClasses = (
  className: ButtonProps["className"],
  variant: ButtonVariant | undefined,
  size: ButtonProps["size"],
  tone: ButtonProps["tone"],
): string => {
  const classes = uiClassNames(
    variant && variant !== "primary" ? variant : "",
    size === "small" ? "small" : "",
    tone === "danger" ? "danger" : "",
    className,
  );
  return classes.length === 0 ? "" : ` class="${classes}"`;
};

/**
 * Renders a text button. Labels are plain text and escaped; callers may select
 * a registered decorative icon but cannot inject arbitrary markup.
 */
export const button = ({
  attributes,
  className,
  disabled = false,
  icon: iconName,
  iconPosition = "before",
  label,
  size = "default",
  tone = "default",
  type = "button",
  variant = "primary",
}: ButtonProps): string =>
  `<button${controlClasses(className, variant, size, tone)}${uiAttributes(attributes)} type="${type}"${disabled ? " disabled" : ""}>${iconName && iconPosition === "before" ? icon(iconName) : ""}${escapeHtml(label)}${iconName && iconPosition === "after" ? icon(iconName) : ""}</button>`;

/**
 * Shared icon-button configuration. The visible glyph is decorative; the
 * escaped label is applied to both `aria-label` and `title`.
 */
export type IconButtonProps = {
  readonly attributes?: UiAttributes;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly icon: IconName;
  readonly label: string;
  readonly title?: string;
  readonly tone?: "danger" | "default";
  readonly variant?: "default" | "ghost";
};

/**
 * Renders a compact icon-only button with an explicit accessible name.
 */
export const iconButton = ({
  attributes,
  className,
  disabled = false,
  icon: iconName,
  label,
  title,
  tone = "default",
  variant = "default",
}: IconButtonProps): string => {
  const classes = uiClassNames(
    "icon-button",
    variant === "ghost" ? "ghost" : "",
    tone === "danger" ? "danger" : "",
    className,
  );
  const safeLabel = escapeHtml(label);
  return `<button class="${classes}"${uiAttributes(attributes)} type="button" aria-label="${safeLabel}" title="${escapeHtml(title ?? label)}"${disabled ? " disabled" : ""}>${icon(iconName)}</button>`;
};

/**
 * Shared icon-link configuration for an extension-owned or HTTPS destination.
 */
export type IconLinkProps = {
  readonly attributes?: UiAttributes;
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly target?: "_blank" | "_self";
  readonly variant?: "default" | "ghost";
};

/**
 * Renders a compact icon-only link with the same accessible treatment as an
 * icon button. Callers own destination policy; all values are escaped and a
 * new browsing context is isolated from the extension.
 */
export const iconLink = ({
  attributes,
  href,
  icon: iconName,
  label,
  target = "_self",
  variant = "default",
}: IconLinkProps): string => {
  const classes = uiClassNames("icon-button", variant === "ghost" ? "ghost" : "");
  const safeLabel = escapeHtml(label);
  return `<a class="${classes}" href="${escapeHtml(href)}" target="${target}"${target === "_blank" ? ' rel="noopener noreferrer"' : ""}${uiAttributes(attributes)} aria-label="${safeLabel}" title="${safeLabel}">${icon(iconName)}</a>`;
};

/**
 * Shared action-link configuration for extension-owned destinations.
 */
export type ActionLinkProps = {
  readonly attributes?: UiAttributes;
  readonly href: string;
  readonly label: string;
  readonly target?: "_blank" | "_self";
};

/**
 * Renders a primary action link. The destination and label are escaped; links
 * opening a new context always receive `noopener`.
 */
export const actionLink = ({
  attributes,
  href,
  label,
  target = "_self",
}: ActionLinkProps): string =>
  `<a class="onboarding-launch" href="${escapeHtml(href)}" target="${target}"${target === "_blank" ? ' rel="noopener"' : ""}${uiAttributes(attributes)}>${escapeHtml(label)}</a>`;

/**
 * One option in a segmented control.
 */
export type SegmentedOption = {
  readonly attributes?: UiAttributes;
  readonly disabled?: boolean;
  readonly label: string;
  readonly pressed: boolean;
};

/**
 * Renders a mutually exclusive compact control group. Selection state is
 * explicit and every label/attribute passes through the shared safe boundary.
 */
export const segmentedControl = (label: string, options: readonly SegmentedOption[]): string =>
  `<div class="seg" role="group" aria-label="${escapeHtml(label)}">${options
    .map(
      (option) =>
        `<button class="seg-option"${uiAttributes(option.attributes)} type="button" aria-pressed="${option.pressed}"${option.disabled ? " disabled" : ""}>${escapeHtml(option.label)}</button>`,
    )
    .join("")}</div>`;
