import { escapeHtml } from "@mc-wallet/core/html";

/**
 * Wraps related specimens in a documented catalog section.
 */
export const catalogGroup = (title: string, description: string, body: string): string => `
  <section class="catalog-group">
    <header><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></header>
    ${body}
  </section>`;

/**
 * Wraps one component specimen without altering the production component.
 */
export const catalogSample = (label: string, body: string, className = ""): string =>
  `<div class="catalog-sample${className ? ` ${className}` : ""}"><h3>${escapeHtml(label)}</h3>${body}</div>`;
