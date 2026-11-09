/**
 * Trusted DOM construction helpers for the Ledger grant page. The page never
 * assigns string HTML: every node is created through these, and text lands via
 * `textContent`, so nothing read from a device or the broker can become markup.
 */
import { BRAMBLE_MARK_PATH, BRAMBLE_MARK_VIEW_BOX } from "@bramble/ui-kit/brand-mark";

/**
 * Creates an element, optionally with a class name.
 */
export const element = <Name extends keyof HTMLElementTagNameMap>(
  name: Name,
  className?: string,
): HTMLElementTagNameMap[Name] => {
  const node = document.createElement(name);
  if (className) {
    node.className = className;
  }
  return node;
};

/**
 * The Bramble mark as a DOM-built SVG, filled with the surrounding text colour
 * like the side panel's inline mark. Decorative: it always sits beside the name.
 */
export const brandMark = (): SVGSVGElement => {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", BRAMBLE_MARK_VIEW_BOX);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("brand-glyph");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("fill-rule", "nonzero");
  path.setAttribute("d", BRAMBLE_MARK_PATH);
  svg.append(path);
  return svg;
};

/**
 * Creates an element whose only content is the given text, set via
 * `textContent` so it can never be parsed as markup.
 */
export const textElement = <Name extends keyof HTMLElementTagNameMap>(
  name: Name,
  className: string,
  text: string,
): HTMLElementTagNameMap[Name] => {
  const node = element(name, className);
  node.textContent = text;
  return node;
};
