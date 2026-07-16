/**
 * Open-state persistence for native `<details class="disclosure">` accordions.
 * Every shell repaint rebuilds the DOM, which would snap open disclosures shut
 * mid-edit (e.g. while typing a custom RPC URL and a background refresh
 * repaints). This module keeps the set of open disclosure ids for the panel
 * session and re-applies it synchronously after each render, so native
 * disclosure behaviour stays intact across repaints without any bespoke
 * accordion machinery.
 */

const openDisclosures = new Set<string>();

/**
 * Re-applies persisted open states and records future toggles. Safe to call on
 * every render; screens without disclosures are skipped.
 */
export const bindDisclosures = (app: Element | null): void => {
  app?.querySelectorAll<HTMLDetailsElement>("details[data-disclosure]").forEach((details) => {
    const node = details;
    const id = node.dataset["disclosure"];
    if (!id) {
      return;
    }
    if (openDisclosures.has(id)) {
      node.open = true;
    }
    node.addEventListener("toggle", () => {
      if (node.open) {
        openDisclosures.add(id);
      } else {
        openDisclosures.delete(id);
      }
    });
  });
};
