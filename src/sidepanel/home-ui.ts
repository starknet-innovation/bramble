/**
 * Bindings for the home experience: the account drawer (open/close, switch,
 * add), the tabbed portfolio section, and its overflow quick-actions menu.
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
  readonly drawerGroupFilter: () => string | null;
  readonly setDrawerGroupFilter: (filter: string | null) => void;
  readonly homeTab: () => HomeTab;
  readonly setHomeTab: (tab: HomeTab) => void;
  readonly networkId: () => string;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly selectPortfolio?: (multisigId: string | null) => void;
  readonly startAddAccount?: () => void;
  readonly wallet: SidepanelWallet;
};

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

  // Applies the open state to the freshly (re)bound drawer node. The enter
  // motion — the panel slide and the staggered row keyframe — is gated behind
  // the `is-opening` class, added ONLY for a genuine open (`animateEnter`).
  // Every shell repaint recreates the drawer node, so re-applying a persisted
  // open state must be silent: we skip `is-opening` and, since the fresh node's
  // baseline is the closed transform, suppress the panel transition for one
  // frame so it snaps open in place (mirroring bindTabs' moveIndicator) rather
  // than sliding again.
  const applyOpen = (open: boolean, animateEnter: boolean): void => {
    root.setAttribute("data-open", String(open));
    trigger.setAttribute("aria-expanded", String(open));
    root.classList.toggle("is-opening", open && animateEnter);
    if (open && !animateEnter) {
      const drawer = root.querySelector<HTMLElement>(".account-drawer");
      if (drawer) {
        drawer.style.transition = "none";
        requestAnimationFrame(() => {
          drawer.style.transition = "";
        });
      }
    }
  };

  const setOpen = (open: boolean, moveFocus: boolean): void => {
    deps.setDrawerOpen(open);
    // A user toggle animates: opening slides the sheet in with the row stagger,
    // closing slides it back out.
    applyOpen(open, true);
    if (moveFocus) {
      (open ? closeButton : trigger)?.focus({ preventScroll: true });
    }
  };

  // Restore persisted state before first paint. This runs on every repaint, so
  // it must never replay the enter animation — a genuine open goes through
  // setOpen instead.
  applyOpen(deps.drawerOpen(), false);

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
      const accountId = button.dataset["switchAccount"];
      if (!accountId) {
        return;
      }
      if (button.getAttribute("aria-pressed") === "true") {
        setOpen(false, true);
        return;
      }
      if (button.dataset["activeSigner"] === "true") {
        deps.selectPortfolio?.(null);
        setOpen(false, false);
        void deps.wallet.loadStatus().then(deps.render);
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.setActiveAccount(accountId).then(
        async () => {
          const keepsSharedAccount = button.dataset["selectedMultisigSigner"] === "true";
          if (!keepsSharedAccount) {
            deps.selectPortfolio?.(null);
          }
          deps.setDrawerOpen(false);
          showToast(
            keepsSharedAccount ? "Multisig signer switched" : "Account switched",
            "success",
          );
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Account switch failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-multisig-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["multisigSelect"];
      if (!id) {
        return;
      }
      if (button.getAttribute("aria-pressed") === "true") {
        setOpen(false, true);
        return;
      }
      setOpen(false, false);
      deps.selectPortfolio?.(id);
      void deps.wallet.loadStatus().then(deps.render);
    });
  });

  // Folder filter chips narrow the listed accounts to a group's members; the
  // selection persists across re-renders via the entrypoint module var, so the
  // drawer reopens showing the same folder.
  root.querySelectorAll<HTMLButtonElement>("[data-group-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const value = chip.dataset["groupFilter"];
      const next = !value || value === "all" ? null : value;
      if (next === deps.drawerGroupFilter()) {
        return;
      }
      deps.setDrawerGroupFilter(next);
      void deps.wallet.loadStatus().then(deps.render);
    });
  });

  const addButton = root.querySelector<HTMLButtonElement>("#drawer-add-account");
  addButton?.addEventListener("click", () => {
    deps.setDrawerOpen(false);
    deps.startAddAccount?.();
  });

  bindDrawerDrag(root, deps.drawerOpen, () => setOpen(false, false));
};

const portfolioMenuApps = new WeakSet<Element>();

const setPortfolioMenuOpen = (app: Element, open: boolean, focusItem = false): void => {
  const trigger = app.querySelector<HTMLButtonElement>("#portfolio-menu-trigger");
  const menu = app.querySelector<HTMLElement>("#portfolio-menu");
  if (!trigger || !menu) {
    return;
  }
  trigger.setAttribute("aria-expanded", String(open));
  menu.hidden = !open;
  if (open && focusItem) {
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }
};

const bindPortfolioMenu = (deps: HomeUiDeps): void => {
  const app = deps.app;
  const root = app?.querySelector<HTMLElement>(".portfolio-actions");
  const trigger = root?.querySelector<HTMLButtonElement>("#portfolio-menu-trigger");
  const menu = root?.querySelector<HTMLElement>("#portfolio-menu");
  const items = menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : [];
  if (!app || !root || !trigger || !menu) {
    return;
  }

  const isOpen = (): boolean => !menu.hidden;
  const close = (returnFocus = false): void => {
    setPortfolioMenuOpen(app, false);
    if (returnFocus) {
      trigger.focus({ preventScroll: true });
    }
  };

  trigger.addEventListener("click", () => setPortfolioMenuOpen(app, !isOpen()));
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    setPortfolioMenuOpen(app, true, event.key === "ArrowDown");
    if (event.key === "ArrowUp") {
      items.at(-1)?.focus({ preventScroll: true });
    }
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    const current = items.indexOf(menu.ownerDocument.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % items.length
            : event.key === "ArrowUp"
              ? (current - 1 + items.length) % items.length
              : -1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus({ preventScroll: true });
    }
  });
  items.forEach((item) => {
    item.addEventListener("click", () => close());
  });
  root.addEventListener("focusout", (event) => {
    if (!event.relatedTarget || !root.contains(event.relatedTarget as Node)) {
      close();
    }
  });

  if (!portfolioMenuApps.has(app)) {
    app.addEventListener("pointerdown", (event) => {
      const currentRoot = app.querySelector<HTMLElement>(".portfolio-actions");
      if (currentRoot && event.target && !currentRoot.contains(event.target as Node)) {
        setPortfolioMenuOpen(app, false);
      }
    });
    portfolioMenuApps.add(app);
  }
};

const bindTabs = (deps: HomeUiDeps): void => {
  const tabsRoot = deps.app?.querySelector<HTMLElement>(".home-tabs");
  if (!tabsRoot) {
    return;
  }

  const applyTab = (tab: HomeTab): void => {
    tabsRoot.setAttribute("data-active-tab", tab);
    tabsRoot.querySelectorAll<HTMLButtonElement>("[data-home-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset["homeTab"] === tab));
    });
    tabsRoot.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach((panel) => {
      const target = panel;
      const on = target.dataset["tabPanel"] === tab;
      target.hidden = !on;
    });
  };

  // Restore the remembered tab before first paint.
  applyTab(deps.homeTab());

  tabsRoot.querySelectorAll<HTMLButtonElement>("[data-home-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset["homeTab"];
      if (!isHomeTab(tab) || tab === deps.homeTab()) {
        return;
      }
      deps.setHomeTab(tab);
      applyTab(tab);
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
  bindPortfolioMenu(deps);
};
