/**
 * The shared token dropdown: how it opens, what a search inside a group filters,
 * and that it keeps working after its owner refills the panel.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bindTokenDropdown, tokenDropdown, tokenDropdownOptions } from "@bramble/wallet-ui/lab";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const GROUPS = [
  {
    label: "Your tokens",
    options: [
      { address: "0x1", id: "SN_MAIN:STRK", symbol: "STRK" },
      { address: "0x2", id: "SN_MAIN:ETH", symbol: "ETH" },
    ],
  },
  {
    label: "More tokens",
    options: [
      { address: "0x3", id: "SN_MAIN:USDC", symbol: "USDC" },
      { address: "0x4", id: "SN_MAIN:USDT", symbol: "USDT" },
      { address: "0x5", id: "SN_MAIN:DAI", symbol: "DAI" },
    ],
    search: true,
  },
];

const mount = (): { acted: number; picked: string[]; root: HTMLElement } => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  root.className = "token-dropdown";
  root.innerHTML = `<button id="trigger" type="button">Select</button>${tokenDropdown({
    action: "Manage tokens",
    groups: GROUPS,
    label: "Tokens",
    panelId: "options",
  })}`;
  document.body.append(root);
  const picked: string[] = [];
  const state = { acted: 0 };
  bindTokenDropdown({
    onAction: () => {
      state.acted += 1;
    },
    onSelect: (id) => picked.push(id),
    panelId: "options",
    root,
    triggerId: "trigger",
  });
  return {
    get acted() {
      return state.acted;
    },
    picked,
    root,
  };
};

const type = (root: HTMLElement, text: string): void => {
  const field = root.querySelector<HTMLInputElement>("[data-token-search]");
  if (!field) throw new Error("no search field");
  field.value = text;
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const visible = (root: HTMLElement): readonly string[] =>
  [...root.querySelectorAll<HTMLElement>("[data-token-option]")]
    .filter((option) => !option.hasAttribute("hidden"))
    .map((option) => option.dataset["tokenSymbol"] ?? "");

describe("token dropdown", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("opens on its trigger and closes on a pick", () => {
    const { picked, root } = mount();
    const panel = root.querySelector<HTMLElement>("#options");

    expect(panel?.hasAttribute("hidden")).toBe(true);
    root.querySelector<HTMLButtonElement>("#trigger")?.click();
    expect(panel?.hasAttribute("hidden")).toBe(false);

    root.querySelector<HTMLButtonElement>("[data-token-option]")?.click();
    expect(picked).toEqual(["SN_MAIN:STRK"]);
    expect(panel?.hasAttribute("hidden")).toBe(true);
  });

  test("a search filters its own group to the tickers that match", () => {
    const { root } = mount();
    root.querySelector<HTMLButtonElement>("#trigger")?.click();

    type(root, "usd");

    // Its own group narrows; the group above it is untouched.
    expect(visible(root)).toEqual(["STRK", "ETH", "USDC", "USDT"]);
    type(root, "dai");
    expect(visible(root)).toEqual(["STRK", "ETH", "DAI"]);
    type(root, "");
    expect(visible(root)).toEqual(["STRK", "ETH", "USDC", "USDT", "DAI"]);
  });

  test("says when nothing matches instead of showing an empty group", () => {
    const { root } = mount();
    root.querySelector<HTMLButtonElement>("#trigger")?.click();

    type(root, "zzz");

    expect(visible(root)).toEqual(["STRK", "ETH"]);
    expect(
      root.querySelector<HTMLElement>("[data-token-search-empty]")?.hasAttribute("hidden"),
    ).toBe(false);
  });

  test("keeps filtering after the owner refills the panel", () => {
    // Swap fills its panel again when the AVNU catalog lands, which replaces
    // the search field. A listener bound to the old field died with it and
    // typing stopped doing anything.
    const { root } = mount();
    const panel = root.querySelector<HTMLElement>("#options");
    if (!panel) throw new Error("no panel");
    root.querySelector<HTMLButtonElement>("#trigger")?.click();

    panel.innerHTML = tokenDropdownOptions(GROUPS, "options");
    type(root, "usdt");

    expect(visible(root)).toEqual(["STRK", "ETH", "USDT"]);
  });

  test("keeps one outside-click listener per panel across rebuilt screens", () => {
    // Swap rebuilds its panels on every shell paint and binds again each time;
    // the listeners of the panels it threw away must not pile up on the
    // document, and a listener whose panel has gone must let go of itself.
    const live = new Set<EventListenerOrEventListenerObject>();
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "click") live.add(listener);
      add(type, listener);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      if (type === "click") live.delete(listener);
      remove(type, listener);
    }) as typeof document.removeEventListener;
    try {
      mount();
      mount();
      const { root } = mount();
      expect(live.size).toBe(1);

      root.remove();
      document.body.dispatchEvent(new window.Event("click", { bubbles: true }));
      expect(live.size).toBe(0);
    } finally {
      document.addEventListener = add;
      document.removeEventListener = remove;
    }
  });

  test("ends with a way out for a token it does not list", () => {
    const view = mount();
    view.root.querySelector<HTMLButtonElement>("#trigger")?.click();
    // The action is not an option: search never hides it and it reports apart.
    type(view.root, "zzz");

    const action = view.root.querySelector<HTMLButtonElement>("[data-token-action]");
    expect(action?.textContent).toBe("Manage tokens");
    expect(action?.hasAttribute("hidden")).toBe(false);
    expect(action?.hasAttribute("data-token-option")).toBe(false);

    action?.click();
    expect(view.acted).toBe(1);
    expect(view.picked).toEqual([]);
    expect(view.root.querySelector("#options")?.hasAttribute("hidden")).toBe(true);
  });
});
