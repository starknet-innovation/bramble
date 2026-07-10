/**
 * Perps screen event bindings. Follows the wallet's bindAll pattern: operates
 * only on the passed-in `app` element (never document/window), re-attaches on
 * every paint, and is a no-op when the Perps tab is not present. The order-book /
 * trades tabs and the Positions / Trades / Funding / Orders account strip toggle
 * the `hidden` attribute on pre-rendered nodes (same shape as the shell's tab-host
 * toggling — no runtime HTML injection); the Long/Short, Market/Limit and leverage
 * segmented controls flip aria-selected, revealing the limit-price field and
 * relabeling the submit button as the ticket changes. No event handlers are
 * inlined (CSP-safe).
 *
 * Extended is region-locked and `extended.signOrder` is a phase-2 stub that
 * rejects, so the order ticket never signs or broadcasts: submitting stops at an
 * inert notice (it re-surfaces the region-restricted banner and marks the button
 * as unavailable), mirroring how the token swap panel stops at a confirm summary.
 * Focusing a different market (data-perp-market) needs a live-markets fetch plus a
 * re-render and stays a phase-2 concern; the size / limit inputs are free-text
 * only until a live Extended quote feed lands.
 *
 * NOTE (phase-2 integration): register `bindPerps({ app })` inside bindAll() in
 * src/sidepanel/index.ts (next to bindTokens / bindPortfolio) to activate this.
 */
import { SAMPLE_PERPS } from "./data";

/**
 * State accessors the Perps bindings close over. Ticket and tab state is
 * intentionally DOM-local (not persisted across full re-renders), mirroring the
 * token-detail sub-tabs.
 */
export type PerpsUiDeps = {
  readonly app: Element | null;
};

/**
 * Wires one segmented control to its pre-rendered panels within `root`: clicking a
 * `[data-${tabAttr}]` button selects it (aria-selected) and reveals the matching
 * `[data-${panelAttr}]` host, hiding its siblings.
 */
const wireTabPanels = (root: HTMLElement, tabAttr: string, panelAttr: string): void => {
  const buttons = root.querySelectorAll<HTMLButtonElement>(`[data-${tabAttr}]`);
  const panels = root.querySelectorAll<HTMLElement>(`[data-${panelAttr}]`);
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute(`data-${tabAttr}`);
      if (value === null) {
        return;
      }
      buttons.forEach((other) => {
        other.setAttribute(
          "aria-selected",
          String(other.getAttribute(`data-${tabAttr}`) === value),
        );
      });
      panels.forEach((panel) => {
        const host = panel;
        host.hidden = host.getAttribute(`data-${panelAttr}`) !== value;
      });
    });
  });
};

/**
 * Wires a panel-less segmented control (side, order type, leverage): clicking a
 * `[data-${tabAttr}]` button flips aria-selected across the group and invokes
 * `onSelect` with the chosen value for any side effect (revealing the limit-price
 * field, relabeling the submit button).
 */
const wireSegments = (
  root: HTMLElement,
  tabAttr: string,
  onSelect?: (value: string) => void,
): void => {
  const buttons = root.querySelectorAll<HTMLButtonElement>(`[data-${tabAttr}]`);
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute(`data-${tabAttr}`);
      if (value === null) {
        return;
      }
      buttons.forEach((other) => {
        other.setAttribute("aria-selected", String(other === button));
      });
      onSelect?.(value);
    });
  });
};

/**
 * Wires the order ticket: the Market/Limit and Long/Short toggles, leverage
 * presets, the Auto-Close switch, and the region-locked submit. Submit is inert by
 * design — it re-reveals the region banner and marks itself unavailable instead of
 * calling the throwing `extended.signOrder` stub.
 */
const bindTicket = (panel: HTMLElement): void => {
  const detail = panel.querySelector<HTMLElement>("[data-perp-detail]");
  const market = SAMPLE_PERPS.find((row) => row.id === detail?.getAttribute("data-perp-detail"));
  const submit = panel.querySelector<HTMLButtonElement>("[data-perp-submit]");
  const limitField = panel.querySelector<HTMLElement>("[data-perp-limit-field]");
  const region = panel.querySelector<HTMLElement>("[data-perp-region]");
  const autoClose = panel.querySelector<HTMLButtonElement>("[data-perp-autoclose]");

  wireSegments(panel, "perp-order-type", (value) => {
    if (limitField) {
      limitField.hidden = value !== "limit";
    }
  });

  wireSegments(panel, "perp-side", (value) => {
    if (submit && market) {
      submit.disabled = false;
      submit.setAttribute("data-perp-side-value", value);
      submit.textContent = `Open ${value} ${market.baseSymbol}`;
    }
  });

  wireSegments(panel, "perp-leverage");

  autoClose?.addEventListener("click", () => {
    autoClose.setAttribute(
      "aria-pressed",
      String(autoClose.getAttribute("aria-pressed") !== "true"),
    );
  });

  submit?.addEventListener("click", () => {
    // Region-locked: never reach extended.signOrder (it rejects). Stop at an inert
    // notice, re-surfacing the region banner in case it was dismissed.
    if (region) {
      region.hidden = false;
    }
    submit.disabled = true;
    submit.textContent = "Signing not available in your region";
  });
};

/**
 * Binds the Perps screen: the dismissible region banner, the order-book / trades
 * and account sub-tabs, and the order ticket. Safe to call on every render;
 * returns immediately when the Perps panel is not on screen. Sub-tab and ticket
 * state resets on a full repaint, mirroring the ephemeral token-detail sub-views.
 */
export const bindPerps = (deps: PerpsUiDeps): void => {
  const panel = deps.app?.querySelector<HTMLElement>('[data-trade-panel="perps"]');
  if (!panel) {
    return;
  }
  const region = panel.querySelector<HTMLElement>("[data-perp-region]");
  panel.querySelector<HTMLButtonElement>("[data-perp-dismiss]")?.addEventListener("click", () => {
    if (region) {
      region.hidden = true;
    }
  });
  wireTabPanels(panel, "perp-book-tab", "perp-book-panel");
  wireTabPanels(panel, "perp-account-tab", "perp-account-panel");
  bindTicket(panel);
};
