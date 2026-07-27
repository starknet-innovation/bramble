/**
 * Shared navigation-row templates for settings hubs and chooser lists.
 */
import { escapeHtml } from "../shared/html";
import { badge } from "./content";
import { type UiAttributes, uiAttributes, uiClassNames } from "./html-attributes";
import { type IconName, icon } from "./icons";

/**
 * Shared grouped-menu row configuration.
 */
export type MenuRowProps = {
  readonly attributes?: UiAttributes;
  readonly className?: string;
  readonly icon: IconName;
  readonly label: string;
  readonly supportingText?: string;
  readonly value?: string;
};

/**
 * Renders a grouped menu destination. Dynamic copy is escaped and the only
 * navigation capability comes from audited data/id attributes.
 */
export const menuRow = ({
  attributes,
  className,
  icon: iconName,
  label,
  supportingText,
  value,
}: MenuRowProps): string =>
  `<button class="${uiClassNames("menu-row", className)}"${uiAttributes(attributes)} type="button">
    <span class="menu-icon">${icon(iconName)}</span>
    <span class="menu-copy"><strong>${escapeHtml(label)}</strong>${supportingText ? `<span class="hint">${escapeHtml(supportingText)}</span>` : ""}</span>
    ${value ? `<span class="menu-value">${escapeHtml(value)}</span>` : ""}
    <span class="menu-chevron">${icon("chevronRight")}</span>
  </button>`;

/**
 * Shared grouped-menu link configuration.
 */
export type MenuLinkProps = Omit<MenuRowProps, "attributes"> & {
  readonly attributes?: UiAttributes;
  readonly href: string;
  readonly target?: "_blank" | "_self";
};

/**
 * Renders a grouped navigation row that leaves the extension. Values are
 * escaped and links opening a new context cannot retain an opener.
 */
export const menuLink = ({
  attributes,
  className,
  href,
  icon: iconName,
  label,
  supportingText,
  target = "_self",
  value,
}: MenuLinkProps): string =>
  `<a class="${uiClassNames("menu-row", className)}" href="${escapeHtml(href)}" target="${target}"${target === "_blank" ? ' rel="noopener noreferrer"' : ""}${uiAttributes(attributes)}>
    <span class="menu-icon">${icon(iconName)}</span>
    <span class="menu-copy"><strong>${escapeHtml(label)}</strong>${supportingText ? `<span class="hint">${escapeHtml(supportingText)}</span>` : ""}</span>
    ${value ? `<span class="menu-value">${escapeHtml(value)}</span>` : ""}
    <span class="menu-chevron">${icon("chevronRight")}</span>
  </a>`;

/**
 * Shared chooser-row configuration.
 */
export type OptionRowProps = MenuRowProps & {
  readonly pressed?: boolean;
  readonly supportingText?: string;
};

/**
 * Renders an escaped selectable row for account, network, token, and device
 * choosers.
 */
export const optionRow = ({
  attributes,
  icon: iconName,
  label,
  pressed = false,
  supportingText,
  value,
}: OptionRowProps): string =>
  `<button class="option-row"${uiAttributes(attributes)} type="button" aria-pressed="${pressed}">
    <span class="menu-icon">${icon(iconName)}</span>
    <span class="menu-copy"><strong>${escapeHtml(label)}</strong>${supportingText ? `<small>${escapeHtml(supportingText)}</small>` : ""}</span>
    ${value ? `<span class="menu-value">${escapeHtml(value)}</span>` : ""}
    <span class="menu-chevron">${icon("chevronRight")}</span>
  </button>`;

/**
 * One destination in the persistent wallet dock.
 */
export type DockItemProps = {
  readonly attributes?: UiAttributes;
  readonly controls: string;
  readonly count?: number;
  readonly icon: IconName;
  readonly label: string;
  readonly selected: boolean;
};

/**
 * Renders the shared bottom dock. Labels and target ids are escaped, count
 * badges are validated, and navigation capabilities remain explicit data
 * attributes.
 */
export const dockNavigation = (items: readonly DockItemProps[]): string =>
  `<nav class="wallet-dock" aria-label="Wallet screens" role="tablist">${items
    .map(
      (item) =>
        `<button class="nav-item"${uiAttributes(item.attributes)} type="button" role="tab" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.label)}" aria-controls="${escapeHtml(item.controls)}" aria-selected="${item.selected}">
          <span class="tab-icon">${icon(item.icon)}${item.count && item.count > 0 ? badge(item.count) : ""}</span>
          <span class="tab-label">${escapeHtml(item.label)}</span>
        </button>`,
    )
    .join("")}</nav>`;
