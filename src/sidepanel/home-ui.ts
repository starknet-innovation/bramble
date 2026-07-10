/**
 * Bindings for the home experience: the account drawer (open/close, switch,
 * add) and the tabbed portfolio section (tab switching, sliding indicator).
 * Both re-apply persisted state synchronously after each re-render — before
 * the frame paints — so the drawer and active tab survive repaints without
 * replaying their animations.
 */
import type { WalletStatus } from "../popup/responses";
import { resolveSpring } from "../ui/spring";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { type HomeTab, isHomeTab } from "./home-tabs";
import { prefersReducedMotion, projectMomentum } from "./motion";
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

// Settle spring shared by the drawer's release animation and its CSS transitions
// (the iOS sheet spring, damping 0.8 / response 0.3 — see ../ui/tokens SPRING).
const DRAWER_SPRING = resolveSpring("drawer");
// Movement (px) before a press becomes a drag, so a tap inside the sheet still
// clicks its control instead of being stolen by the gesture.
const DRAG_THRESHOLD = 8;
// Fraction of the sheet width the projected release point must cross to dismiss.
const DISMISS_FRACTION = 0.35;

// Direct-manipulation dismissal for the account drawer: the sheet tracks the
// pointer 1:1 as it is dragged toward its closed (left) edge, resists an
// over-drag past the open edge, and on release projects the flick's momentum
// (Apple's decay model) to decide whether to fall closed or spring back — so the
// gesture and the animation share one continuous, velocity-aware motion. Under
// reduced motion the release cuts straight to the resting state.
const bindDrawerDrag = (root: HTMLElement, isOpen: () => boolean, close: () => void): void => {
  const drawer = root.querySelector<HTMLElement>(".account-drawer");
  const backdrop = root.querySelector<HTMLElement>(".drawer-backdrop");
  if (!drawer || !backdrop) {
    return;
  }

  let armed = false;
  let dragging = false;
  let startX = 0;
  let offset = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let width = 300;

  // Progressive resistance past the open edge — real things slow before a wall.
  const rubberband = (over: number): number => (over * 24) / (24 + over);

  const reset = (): void => {
    drawer.style.transition = "";
    drawer.style.transform = "";
    backdrop.style.transition = "";
    backdrop.style.opacity = "";
  };

  const settle = (dismiss: boolean): void => {
    if (prefersReducedMotion()) {
      if (dismiss) {
        close();
      }
      reset();
      return;
    }
    const end = (event: TransitionEvent): void => {
      if (event.propertyName !== "transform") {
        return;
      }
      drawer.removeEventListener("transitionend", end);
      if (dismiss) {
        close();
      }
      reset();
    };
    drawer.addEventListener("transitionend", end);
    drawer.style.transition = `transform ${DRAWER_SPRING.durationMs}ms ${DRAWER_SPRING.easing}`;
    backdrop.style.transition = `opacity ${DRAWER_SPRING.durationMs}ms var(--ease-drawer)`;
    drawer.style.transform = dismiss ? "translateX(-104%)" : "translateX(0)";
    backdrop.style.opacity = dismiss ? "0" : "1";
  };

  drawer.addEventListener("pointerdown", (event: PointerEvent) => {
    // Ignore extra touch points once a gesture is in progress so a second
    // finger cannot reset the origin and jump the sheet mid-drag.
    if (!isOpen() || event.button !== 0 || armed) {
      return;
    }
    armed = true;
    dragging = false;
    startX = event.clientX;
    lastX = event.clientX;
    lastT = event.timeStamp;
    velocity = 0;
    offset = 0;
    width = drawer.offsetWidth || width;
  });

  drawer.addEventListener("pointermove", (event: PointerEvent) => {
    if (!armed) {
      return;
    }
    const dx = event.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) {
        return;
      }
      dragging = true;
      drawer.setPointerCapture(event.pointerId);
      drawer.style.transition = "none";
      backdrop.style.transition = "none";
    }
    const dt = event.timeStamp - lastT;
    if (dt > 0) {
      velocity = ((event.clientX - lastX) / dt) * 1000;
    }
    lastX = event.clientX;
    lastT = event.timeStamp;
    // Leftward travel dismisses; a rightward over-drag rubber-bands at the edge.
    offset = dx <= 0 ? dx : rubberband(dx);
    drawer.style.transform = `translateX(${offset}px)`;
    backdrop.style.opacity = String(1 - Math.min(1, Math.max(0, -offset / width)));
  });

  const release = (event: PointerEvent): void => {
    if (!armed) {
      return;
    }
    armed = false;
    if (!dragging) {
      return;
    }
    dragging = false;
    if (drawer.hasPointerCapture(event.pointerId)) {
      drawer.releasePointerCapture(event.pointerId);
    }
    const projected = offset + projectMomentum(velocity);
    settle(projected <= -width * DISMISS_FRACTION);
  };
  drawer.addEventListener("pointerup", release);
  drawer.addEventListener("pointercancel", release);
};

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

  bindDrawerDrag(root, deps.drawerOpen, () => setOpen(false, false));
};

const bindTabs = (deps: HomeUiDeps): void => {
  const tabsRoot = deps.app?.querySelector<HTMLElement>(".home-tabs");
  if (!tabsRoot) {
    return;
  }
  const indicator = tabsRoot.querySelector<HTMLElement>(".tab-indicator");

  const moveIndicator = (animate: boolean): void => {
    const active = tabsRoot.querySelector<HTMLElement>('.home-tab[aria-selected="true"]');
    if (!active || !indicator) {
      return;
    }
    const width = `${Math.max(active.offsetWidth - INDICATOR_INSET * 2, 12)}px`;
    const offset = `translateX(${active.offsetLeft + INDICATOR_INSET}px)`;
    if (animate) {
      indicator.style.width = width;
      indicator.style.transform = offset;
      return;
    }
    // On a data re-render the indicator element is fresh at its resting spot, so
    // snap it into place with the transition suppressed — streaming balance and
    // price updates must never make the underline glide. Restore the transition
    // next frame so an explicit tab change still slides.
    indicator.style.transition = "none";
    indicator.style.width = width;
    indicator.style.transform = offset;
    requestAnimationFrame(() => {
      indicator.style.transition = "";
    });
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
    moveIndicator(animate);
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
