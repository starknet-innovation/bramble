/**
 * Bindings for the home experience: the account drawer (open/close, switch,
 * add) and the tabbed portfolio section (tab switching, sliding indicator).
 * Both re-apply persisted state synchronously after each re-render — before
 * the frame paints — so the drawer and active tab survive repaints without
 * replaying their animations.
 */
import type { WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { type HomeTab, isHomeTab } from "./home-tabs";
import type { SidepanelWallet } from "./runtime";

/**
 * State accessors and services the home bindings close over. State lives in
 * the entrypoint so it survives full re-renders.
 */
export type HomeUiDeps = {
  readonly app: Element | null;
  readonly drawerOpen: () => boolean;
  readonly setDrawerOpen: (open: boolean) => void;
  readonly homeTab: () => HomeTab;
  readonly setHomeTab: (tab: HomeTab) => void;
  readonly networkId: () => string;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

const INDICATOR_INSET = 10;

const bindDrawer = (deps: HomeUiDeps): void => {
  const root = deps.app?.querySelector<HTMLElement>(".drawer-root");
  const trigger = deps.app?.querySelector<HTMLButtonElement>("#account-trigger");
  if (!root || !trigger) {
    return;
  }
  const closeButton = root.querySelector<HTMLButtonElement>(".drawer-close");

  const applyOpen = (open: boolean): void => {
    root.setAttribute("data-open", String(open));
    trigger.setAttribute("aria-expanded", String(open));
  };

  const setOpen = (open: boolean, moveFocus: boolean): void => {
    deps.setDrawerOpen(open);
    applyOpen(open);
    if (moveFocus) {
      (open ? closeButton : trigger)?.focus({ preventScroll: true });
    }
  };

  // Restore persisted state before first paint so reopening after a repaint
  // does not replay the slide.
  applyOpen(deps.drawerOpen());

  trigger.addEventListener("click", () => setOpen(!deps.drawerOpen(), true));
  root.querySelectorAll<HTMLElement>("[data-drawer-close]").forEach((control) => {
    control.addEventListener("click", () => setOpen(false, true));
  });
  root.addEventListener("keydown", (event) => {
    if (event instanceof KeyboardEvent && event.key === "Escape" && deps.drawerOpen()) {
      setOpen(false, true);
    }
  });

  root.querySelectorAll<HTMLButtonElement>("[data-switch-account]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = button.dataset.switchAccount;
      if (!accountId) {
        return;
      }
      if (button.getAttribute("aria-pressed") === "true") {
        setOpen(false, true);
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.setActiveAccount(accountId).then(
        async () => {
          deps.setDrawerOpen(false);
          showToast("Account switched", "success");
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Account switch failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });

  const addButton = root.querySelector<HTMLButtonElement>("#drawer-add-account");
  addButton?.addEventListener("click", () => {
    buttonBusy(addButton, true);
    void deps.wallet.addAccount(deps.networkId()).then(
      async () => {
        showToast("Account added", "success");
        await deps.render(await deps.wallet.loadStatus());
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Add account failed"), "error");
        buttonBusy(addButton, false);
      },
    );
  });
};

const bindTabs = (deps: HomeUiDeps): void => {
  const tabsRoot = deps.app?.querySelector<HTMLElement>(".home-tabs");
  if (!tabsRoot) {
    return;
  }
  const indicator = tabsRoot.querySelector<HTMLElement>(".tab-indicator");

  const moveIndicator = (): void => {
    const active = tabsRoot.querySelector<HTMLElement>('.home-tab[aria-selected="true"]');
    if (!active || !indicator) {
      return;
    }
    indicator.style.width = `${Math.max(active.offsetWidth - INDICATOR_INSET * 2, 12)}px`;
    indicator.style.transform = `translateX(${active.offsetLeft + INDICATOR_INSET}px)`;
  };

  const applyTab = (tab: HomeTab, animate: boolean): void => {
    tabsRoot.setAttribute("data-active-tab", tab);
    tabsRoot.querySelectorAll<HTMLButtonElement>("[data-home-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.homeTab === tab));
    });
    tabsRoot.querySelectorAll<HTMLElement>("[data-tab-actions]").forEach((actions) => {
      const target = actions;
      target.hidden = target.dataset.tabActions !== tab;
    });
    tabsRoot.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach((panel) => {
      const target = panel;
      const on = target.dataset.tabPanel === tab;
      if (on && animate) {
        // Re-runs the enter animation: the panel was display:none, so the
        // animation restarts when it becomes visible again.
        target.classList.add("is-entering");
      }
      target.hidden = !on;
    });
    moveIndicator();
  };

  // Restore the remembered tab before first paint; the indicator is measured
  // against final layout so it lands without a glide.
  applyTab(deps.homeTab(), false);

  tabsRoot.querySelectorAll<HTMLButtonElement>("[data-home-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.homeTab;
      if (!isHomeTab(tab) || tab === deps.homeTab()) {
        return;
      }
      deps.setHomeTab(tab);
      applyTab(tab, true);
    });
  });
};

/**
 * Binds the account drawer and portfolio tabs on the home screen. Safe to call
 * on every render; screens without these regions are skipped.
 */
export const bindHomeUi = (deps: HomeUiDeps): void => {
  bindDrawer(deps);
  bindTabs(deps);
};
