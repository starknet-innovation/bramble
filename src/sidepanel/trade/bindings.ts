/**
 * Trade terminal event bindings. Follows the wallet's bindAll pattern: operates
 * only on the passed-in `app` element (never document/window), re-attaches on
 * every paint, and is a no-op on screens without the terminal. Tab switching is
 * done client-side by toggling panel-host visibility, so it never triggers a
 * full re-render; the active tab is persisted by the entrypoint (via setTradeTab)
 * so it survives repaints.
 */
import { isTradeTab, type TradeTab } from "./context";

/**
 * State accessors the trade bindings close over. State lives in the entrypoint
 * so it survives full re-renders, mirroring the home-tab pattern.
 */
export type TradeUiDeps = {
  readonly app: Element | null;
  readonly tradeTab: () => TradeTab;
  readonly setTradeTab: (tab: TradeTab) => void;
};

/**
 * Binds the trade terminal's tab nav. Safe to call on every render; returns
 * immediately when the terminal is not on screen.
 */
export const bindTrade = (deps: TradeUiDeps): void => {
  const terminal = deps.app?.querySelector<HTMLElement>(".trade-terminal");
  const bar = terminal?.querySelector<HTMLElement>(".trade-seg-bar");
  if (!terminal || !bar) {
    return;
  }

  const applyTab = (tab: TradeTab): void => {
    bar.querySelectorAll<HTMLButtonElement>("[data-trade-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.tradeTab === tab));
    });
    terminal.querySelectorAll<HTMLElement>("[data-trade-panel]").forEach((panel) => {
      const host = panel;
      host.hidden = host.dataset.tradePanel !== tab;
    });
  };

  // Restore the remembered tab before first paint so the DOM matches state.
  applyTab(deps.tradeTab());

  bar.querySelectorAll<HTMLButtonElement>("[data-trade-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tradeTab;
      if (!isTradeTab(tab) || tab === deps.tradeTab()) {
        return;
      }
      deps.setTradeTab(tab);
      applyTab(tab);
    });
  });
};
