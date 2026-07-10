/**
 * Portfolio screen event bindings. Follows the wallet's bindAll pattern: operates
 * only on the passed-in `app` element (never document/window), re-attaches on
 * every paint, and is a no-op when the Portfolio tab is not present. The balance
 * hero's Total / Tokens / Perps scope bar and the Tokens / Perps / Token Activity
 * / Perps Activity / Top Movers tab strip both toggle the `hidden` attribute on
 * pre-rendered nodes (same shape as the shell's tab-host toggling — no runtime
 * HTML injection). No event handlers are inlined (CSP-safe).
 *
 * NOTE (phase-2 integration): register `bindPortfolio({ app })` inside bindAll()
 * in src/sidepanel/index.ts (next to bindTrade) to activate this; the
 * foundation-owned entrypoint is intentionally left untouched here.
 */

/**
 * State accessors the Portfolio bindings close over. Tab state is intentionally
 * DOM-local (not persisted across full re-renders), mirroring the token-detail
 * sub-tabs; the trade view queues no per-tab hydration so repaints are rare.
 */
export type PortfolioUiDeps = {
  readonly app: Element | null;
};

/**
 * Wires one segmented control to its pre-rendered panels within `root`: clicking
 * a `[${tabAttr}]` button selects it and reveals the matching `[${panelAttr}]`
 * host, hiding its siblings.
 */
const wireTabs = (root: HTMLElement, tabAttr: string, panelAttr: string): void => {
  const buttons = root.querySelectorAll<HTMLButtonElement>(`[${tabAttr}]`);
  const panels = root.querySelectorAll<HTMLElement>(`[${panelAttr}]`);
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute(tabAttr);
      if (value === null) {
        return;
      }
      buttons.forEach((other) => {
        other.setAttribute("aria-selected", String(other.getAttribute(tabAttr) === value));
      });
      panels.forEach((panel) => {
        const host = panel;
        host.hidden = host.getAttribute(panelAttr) !== value;
      });
    });
  });
};

/**
 * Binds the Portfolio screen's scope sub-tabs and tab strip. Safe to call on
 * every render; returns immediately when the Portfolio panel is not on screen.
 */
export const bindPortfolio = (deps: PortfolioUiDeps): void => {
  const panel = deps.app?.querySelector<HTMLElement>('[data-trade-panel="portfolio"]');
  if (!panel) {
    return;
  }
  wireTabs(panel, "data-portfolio-scope", "data-portfolio-scope-panel");
  wireTabs(panel, "data-portfolio-tab", "data-portfolio-tab-panel");
};
