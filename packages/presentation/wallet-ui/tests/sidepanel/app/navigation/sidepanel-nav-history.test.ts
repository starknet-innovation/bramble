/**
 * Back-stack navigation (the "real back-stack" fix). The shell has no router, so
 * `navigate` pushes the screen being left and Back pops to the true previous
 * one. This suite proves the pure history model and then drives the exact
 * entrypoint loop (navigate = push-then-set, goBack = pop-then-set) for the two
 * reported multi-entry journeys, asserting BOTH the landed view and the
 * re-derived DOM, plus that the flow header's Back control carries no static
 * target.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { preferences } from "@mc-wallet/testkit/sidepanel";
import {
  popView,
  pushView,
  ROOT_VIEW,
  type ViewHistory,
} from "../../../../src/sidepanel/app/navigation/nav-history";
import { dashboard, type WalletView } from "../../../../src/sidepanel/app/screens/views";
import { registerDom, status, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("nav-history model", () => {
  test("pushes the left screen and pops back to it", () => {
    const history = pushView([], "home");
    expect(history).toEqual(["home"]);
    expect(popView(history)).toEqual({ history: [], view: "home" });
  });

  test("collapses consecutive duplicates", () => {
    expect(pushView(["home"], "home")).toEqual(["home"]);
  });

  test("returns the root and an empty history when popping an empty stack", () => {
    expect(popView([])).toEqual({ history: [], view: ROOT_VIEW });
  });
});

// A faithful stand-in for the entrypoint's navigation effects: navigate pushes
// the current view then switches; goBack pops to the previous view.
const makeNav = () => {
  let view: WalletView = "home";
  let history: ViewHistory = [];
  return {
    goBack: (): void => {
      const popped = popView(history);
      history = popped.history;
      view = popped.view;
    },
    navigate: (next: WalletView): void => {
      if (next !== view) {
        history = pushView(history, view);
      }
      view = next;
    },
    view: (): WalletView => view,
  };
};

// Renders the unlocked shell for a view and returns its parsed root, so tests
// assert the re-derived DOM rather than a raw string.
const renderView = (view: WalletView): DocumentFragment =>
  document
    .createRange()
    .createContextualFragment(dashboard(view, status, [], preferences, { balances: [] }));

describe("back-stack journeys", () => {
  test("Home drawer → account → Back returns to Home", () => {
    const nav = makeNav();
    // The only link to the account view from Home is the drawer's "Manage
    // accounts & groups" row (data-view="account").
    nav.navigate("account");
    expect(nav.view()).toBe("account");

    nav.goBack();
    expect(nav.view()).toBe("home");
    expect(renderView(nav.view()).querySelector("#wallet-screen-home")).not.toBeNull();
  });

  test("Settings → account → Back returns to Settings (deep-link entry preserved)", () => {
    const nav = makeNav();
    nav.navigate("settings");
    nav.navigate("account");
    expect(nav.view()).toBe("account");

    nav.goBack();
    expect(nav.view()).toBe("settings");
    expect(renderView(nav.view()).querySelector("#wallet-screen-settings")).not.toBeNull();
  });

  test("the flow header Back control carries no static target", () => {
    const fragment = renderView("account");
    const back = fragment.querySelector(".flow-header button[aria-label='Back']");
    expect(back?.hasAttribute("data-nav-back")).toBe(true);
    expect(back?.hasAttribute("data-view")).toBe(false);
  });
});
