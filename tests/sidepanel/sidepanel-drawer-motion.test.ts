/**
 * Drawer enter-animation gating (the "no re-animation on interaction" fix). The
 * account drawer's slide + row stagger must play only on a genuine open, never
 * when a shell repaint recreates the drawer node while it is already open. The
 * gate is the `is-opening` class: this suite drives the real `bindHomeUi` with a
 * working trigger and a mutable open state, asserting the class is added on a
 * genuine open and stays off across a repaint-while-open.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { accountDrawer } from "../../src/sidepanel/account-drawer";
import { bindHomeUi, type HomeUiDeps } from "../../src/sidepanel/home-ui";
import { acctA, registerDom, status, unregisterDom } from "../support/groups-harness";
import { preferences } from "../support/sidepanel-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);

const setup = () => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  let open = false;
  const paint = (): void => {
    app.replaceChildren(
      document
        .createRange()
        .createContextualFragment(
          '<button id="account-trigger" aria-haspopup="dialog" aria-expanded="false"></button>' +
            accountDrawer(status, acctA, preferences),
        ),
    );
    bindHomeUi({
      app,
      drawerGroupFilter: () => null,
      drawerOpen: () => open,
      homeTab: () => "tokens",
      networkId: () => "SN_MAIN",
      render: async () => {
        paint();
      },
      setDrawerGroupFilter: () => undefined,
      setDrawerOpen: (next) => {
        open = next;
      },
      setHomeTab: () => undefined,
      wallet: {} as HomeUiDeps["wallet"],
    });
  };
  paint();
  return {
    paint,
    root: () => app.querySelector<HTMLElement>(".drawer-root"),
    trigger: () => app.querySelector<HTMLElement>("#account-trigger"),
  };
};

describe("account drawer enter-animation gating", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("a genuine open (trigger tap) arms the enter animation", () => {
    const view = setup();
    expect(view.root()?.classList.contains("is-opening")).toBe(false);

    view.trigger()?.click();

    expect(view.root()?.getAttribute("data-open")).toBe("true");
    expect(view.root()?.classList.contains("is-opening")).toBe(true);
  });

  test("a repaint while open does not replay the enter animation", () => {
    const view = setup();
    view.trigger()?.click();
    expect(view.root()?.classList.contains("is-opening")).toBe(true);

    // An in-drawer interaction repaints the whole shell, recreating the drawer
    // node. It must come back open but WITHOUT is-opening, so the slide + row
    // stagger never replay.
    view.paint();

    expect(view.root()?.getAttribute("data-open")).toBe("true");
    expect(view.root()?.classList.contains("is-opening")).toBe(false);
  });

  test("reopening after a close re-arms the animation", () => {
    const view = setup();
    view.trigger()?.click();
    view.trigger()?.click();
    expect(view.root()?.getAttribute("data-open")).toBe("false");
    expect(view.root()?.classList.contains("is-opening")).toBe(false);

    view.trigger()?.click();
    expect(view.root()?.getAttribute("data-open")).toBe("true");
    expect(view.root()?.classList.contains("is-opening")).toBe(true);
  });
});
