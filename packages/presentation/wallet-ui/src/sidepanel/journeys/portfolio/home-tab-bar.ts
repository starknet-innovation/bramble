/**
 * Home's portfolio tabs: a tab bar and one panel per tab, with the selected
 * panel shown and the others rendered hidden so switching needs no read. The
 * markup (`data-home-tab`, `home-tab-*`, `home-panel-*`) matches the Staking
 * tab's (issue 750), so the tabs read Tokens · NFTs · Staking once both land.
 * Labels are fixed strings; panel bodies are already-escaped markup.
 */

/** The Home portfolio tabs. */
export type HomeTab = "nfts" | "tokens";

// The tab order: arrow keys, Home and End move through it.
const HOME_TABS: readonly HomeTab[] = ["tokens", "nfts"];

/** One tab with its label and rendered panel body. */
export type HomeTabPanel = {
  readonly body: string;
  readonly label: string;
  readonly tab: HomeTab;
};

/**
 * Renders the tab bar and panels for `tabs`, with `selected` open. A selected
 * tab that is not offered falls back to the first one.
 */
export const homeTabPanels = (
  selected: HomeTab,
  tabs: readonly HomeTabPanel[],
): { readonly bar: string; readonly panels: string } => {
  const open = tabs.some((entry) => entry.tab === selected) ? selected : tabs[0]?.tab;
  const tab = ({ label, tab: value }: HomeTabPanel): string =>
    `<button class="home-tab" id="home-tab-${value}" data-home-tab="${value}" type="button" role="tab" aria-controls="home-panel-${value}" aria-selected="${value === open}" tabindex="${value === open ? "0" : "-1"}">${label}</button>`;
  const panel = ({ body, tab: value }: HomeTabPanel): string =>
    `<div id="home-panel-${value}" role="tabpanel" aria-labelledby="home-tab-${value}"${value === open ? "" : " hidden"}>${body}</div>`;
  return {
    bar: `<div class="tab-set" role="tablist" aria-label="Portfolio sections">${tabs.map(tab).join("")}</div>`,
    panels: tabs.map(panel).join(""),
  };
};

/**
 * Binds the Home tabs: a click (or Enter or Space) opens a tab, and the arrow,
 * Home and End keys move through the tab order; focus lands on the opened tab
 * after `select` records the choice and repaints. Absent tabs bind nothing.
 */
export const bindHomeTabs = (
  app: Element | null,
  select: (tab: HomeTab) => Promise<void>,
): void => {
  const offered = (): readonly HomeTab[] =>
    HOME_TABS.filter((tab) => app?.querySelector(`[data-home-tab="${tab}"]`));
  const open = (tab: HomeTab): void => {
    void select(tab).then(() => {
      app?.querySelector<HTMLButtonElement>(`#home-tab-${tab}`)?.focus();
    });
  };
  app?.querySelectorAll<HTMLButtonElement>("[data-home-tab]").forEach((control) => {
    control.addEventListener("click", () => {
      const value = HOME_TABS.find((tab) => tab === control.dataset["homeTab"]);
      // Enter and Space arrive as clicks too; keep focus on the opened tab
      // across the repaint so a keyboard user is not dropped.
      if (value) open(value);
    });
    control.addEventListener("keydown", (event) => {
      const tabs = offered();
      const current = HOME_TABS.find((tab) => tab === control.dataset["homeTab"]);
      const index = current === undefined ? -1 : tabs.indexOf(current);
      const next =
        event.key === "ArrowRight"
          ? tabs[(index + 1) % tabs.length]
          : event.key === "ArrowLeft"
            ? tabs[(index + tabs.length - 1) % tabs.length]
            : event.key === "Home"
              ? tabs[0]
              : event.key === "End"
                ? tabs[tabs.length - 1]
                : undefined;
      if (index < 0 || next === undefined) return;
      event.preventDefault();
      open(next);
    });
  });
};
