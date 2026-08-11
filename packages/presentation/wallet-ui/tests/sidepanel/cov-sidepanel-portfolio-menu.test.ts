/**
 * Portfolio overflow-menu keyboard navigation, focus restoration, and
 * light-dismiss behavior under happy-dom.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bindHomeUi, type HomeUiDeps } from "../../src/sidepanel/home-ui";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const mount = (): HTMLElement => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.innerHTML = `
    <button id="outside" type="button">Outside</button>
    <section class="home-tabs" data-active-tab="tokens">
      <button data-home-tab="tokens" aria-selected="true" type="button">Tokens</button>
      <div class="portfolio-actions">
        <button
          id="portfolio-menu-trigger"
          aria-controls="portfolio-menu"
          aria-expanded="false"
          aria-haspopup="menu"
          type="button"
        >Actions</button>
        <div id="portfolio-menu" role="menu" hidden>
          <button role="menuitem" type="button">Manage tokens</button>
          <button role="menuitem" type="button">Manage collectibles</button>
        </div>
      </div>
    </section>
  `;
  document.body.append(app);
  bindHomeUi({
    app,
    drawerGroupFilter: () => null,
    drawerOpen: () => false,
    homeTab: () => "tokens",
    networkId: () => "SN_MAIN",
    render: async () => undefined,
    setDrawerGroupFilter: () => undefined,
    setDrawerOpen: () => undefined,
    setHomeTab: () => undefined,
    wallet: {} as HomeUiDeps["wallet"],
  });
  return app;
};

const required = <T extends HTMLElement>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing test element: ${selector}`);
  }
  return element;
};

describe("portfolio overflow menu", () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => document.body.replaceChildren());

  test("arrow keys open and navigate while Escape restores trigger focus", () => {
    const app = mount();
    const trigger = required<HTMLButtonElement>(app, "#portfolio-menu-trigger");
    const menu = required<HTMLElement>(app, "#portfolio-menu");
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];

    trigger.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    expect(menu.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.ownerDocument.activeElement).toBe(items[0] ?? null);

    menu.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    expect(menu.ownerDocument.activeElement).toBe(items[1] ?? null);

    menu.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.ownerDocument.activeElement).toBe(trigger);
  });

  test("an outside pointer press light-dismisses the menu", () => {
    const app = mount();
    const trigger = required<HTMLButtonElement>(app, "#portfolio-menu-trigger");
    const menu = required<HTMLElement>(app, "#portfolio-menu");
    trigger.click();

    required<HTMLButtonElement>(app, "#outside").dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
