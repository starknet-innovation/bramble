/**
 * Shared contracts for the trade terminal shell and its four screens: the tab
 * enum used by the top nav and the render context every screen receives. Kept in
 * its own module so the shell, the screens, and the entrypoint binder can share
 * these types without an import cycle.
 */
import type { WalletStatus } from "../../popup/responses";
import type { DisplayCurrency, WalletPreferences } from "../../storage/preferences-store";

/**
 * The terminal's top-level tabs, in display order (mirrors Phantom).
 */
export const TRADE_TABS = ["discover", "tokens", "perps", "portfolio"] as const;

/**
 * One of the terminal's top-level tabs.
 */
export type TradeTab = (typeof TRADE_TABS)[number];

/**
 * Type-guards an untrusted dataset value before switching the active tab.
 */
export const isTradeTab = (value: unknown): value is TradeTab =>
  typeof value === "string" && TRADE_TABS.some((tab) => tab === value);

/**
 * The context every trade screen render function receives. Screens read wallet
 * state through this and use hardcoded sample data (see ./data.ts) for now;
 * phase-2 swaps the data source without changing this shape.
 */
export type TradeScreenContext = {
  readonly status: WalletStatus;
  readonly preferences: WalletPreferences | null;
  readonly currency: DisplayCurrency;
};
