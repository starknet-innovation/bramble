/**
 * Safe HTML-attribute serialization for the wallet's string-template UI.
 * Attribute names are restricted to the small static surface components need;
 * values are always escaped before reaching markup.
 */
import { escapeHtml } from "../shared/html";

const UI_ATTRIBUTE_NAME =
  /^(?:aria-[a-z][a-z0-9-]*|data-[a-z][a-z0-9-]*|hidden|id|name|role|tabindex|title)$/;
const UI_CLASS_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Attributes accepted by shared UI renderers. A false value omits the
 * attribute; true emits a boolean attribute.
 */
export type UiAttributes = Readonly<Record<string, string | boolean>>;

/**
 * Serializes an explicit attribute bag and rejects names outside the audited
 * UI allowlist. This fails closed if a caller tries to create an event handler,
 * style injection, or another arbitrary HTML capability.
 */
export const uiAttributes = (attributes: UiAttributes | undefined): string => {
  if (!attributes) {
    return "";
  }
  return Object.entries(attributes)
    .map(([name, value]) => {
      if (!UI_ATTRIBUTE_NAME.test(name)) {
        throw new Error(`Unsupported UI attribute: ${name}`);
      }
      if (value === false) {
        return "";
      }
      return value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
    })
    .join("");
};

/**
 * Validates and joins static class tokens supplied by production component
 * wrappers. Rejecting whitespace and punctuation per token keeps dynamic text
 * from becoming an HTML or selector capability.
 */
export const uiClassNames = (...groups: readonly (string | undefined)[]): string =>
  groups
    .flatMap((group) => group?.split(" ") ?? [])
    .filter(Boolean)
    .map((name) => {
      if (!UI_CLASS_NAME.test(name)) {
        throw new Error(`Unsupported UI class: ${name}`);
      }
      return name;
    })
    .join(" ");
