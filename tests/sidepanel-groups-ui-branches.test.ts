/**
 * Interactive branches of bindGroupControls that the fixture-driven journeys in
 * tests/sidepanel-groups-ui.test.ts and tests/sidepanel-groups-edge.test.ts do
 * not reach: the dataset guards on every handler (missing/empty ids), the
 * empty-name create guard, and each op's rejection path (error toast + control
 * re-enabled). Controls are hand-built under happy-dom with exactly the
 * attributes each branch needs, then real clicks/submits are dispatched against
 * a fake wallet that records calls and can be made to reject. Mirrors the
 * registerDom harness used by the groups suites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bindGroupControls, type GroupControlDeps } from "../src/sidepanel/group-ui";
import { registerDom, unregisterDom } from "./support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

type WalletCalls = {
  createGroup: unknown[];
  renameGroup: unknown[];
  setGroupIcon: unknown[];
  removeGroup: unknown[];
  setAccountInGroup: unknown[];
};

type Harness = {
  readonly container: HTMLElement;
  readonly calls: WalletCalls;
  readonly rerenders: number;
  readonly expanded: (string | null)[];
  readonly openAssign: (string | null)[];
};

// Mounts markup, wires bindGroupControls against a fake wallet whose ops either
// resolve or reject per `reject`, and records every call and state mutation.
const mount = (html: string, reject = false): Harness => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "app";
  container.append(document.createRange().createContextualFragment(html));
  document.body.append(container);

  const calls: WalletCalls = {
    createGroup: [],
    renameGroup: [],
    setGroupIcon: [],
    removeGroup: [],
    setAccountInGroup: [],
  };
  const harness: Harness = {
    calls,
    container,
    expanded: [],
    openAssign: [],
    rerenders: 0,
  };
  const settle = <T>(value: T): Promise<T> =>
    reject ? Promise.reject(new Error("op failed")) : Promise.resolve(value);

  const wallet = {
    createGroup: (...args: unknown[]) => {
      calls.createGroup.push(args);
      return settle("group-id");
    },
    renameGroup: (...args: unknown[]) => {
      calls.renameGroup.push(args);
      return settle(undefined);
    },
    setGroupIcon: (...args: unknown[]) => {
      calls.setGroupIcon.push(args);
      return settle(undefined);
    },
    removeGroup: (...args: unknown[]) => {
      calls.removeGroup.push(args);
      return settle(undefined);
    },
    setAccountInGroup: (...args: unknown[]) => {
      calls.setAccountInGroup.push(args);
      return settle(undefined);
    },
  };

  const deps: GroupControlDeps = {
    expandedGroup: () => null,
    openAssign: () => null,
    rerender: async () => {
      (harness as { rerenders: number }).rerenders += 1;
    },
    setExpandedGroup: (id) => {
      harness.expanded.push(id);
    },
    setOpenAssign: (id) => {
      harness.openAssign.push(id);
    },
    wallet: wallet as unknown as GroupControlDeps["wallet"],
  };
  bindGroupControls(container, deps);
  return harness;
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const click = (element: Element | null): void => {
  if (!(element instanceof window.HTMLElement)) {
    throw new Error("click target missing");
  }
  element.click();
};

const submit = (form: Element | null): void => {
  if (!(form instanceof window.HTMLFormElement)) {
    throw new Error("form missing");
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

const hasErrorToast = (): boolean => document.querySelector(".toast.error") !== null;
const errorTexts = (): string[] =>
  Array.from(document.querySelectorAll(".toast.error .toast-text")).map((n) => n.textContent ?? "");

describe("bindGroupControls dataset guards", () => {
  beforeEach(() => document.body.replaceChildren());

  test("an icon option with no glyph, or a picker with no value input, is a no-op", () => {
    const harness = mount(
      `<div class="group-icon-picker">
         <input type="hidden" data-group-icon-value value="" />
         <button id="empty-glyph" data-group-icon="" aria-pressed="false" type="button"></button>
       </div>
       <div class="group-icon-picker">
         <button id="no-value" data-group-icon="star" aria-pressed="false" type="button"></button>
       </div>`,
    );

    click(harness.container.querySelector("#empty-glyph"));
    click(harness.container.querySelector("#no-value"));

    // Neither option flipped its own aria-pressed: the guard returned first.
    expect(harness.container.querySelector("#empty-glyph")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(harness.container.querySelector("#no-value")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    // The hidden value input was never populated.
    expect(
      harness.container.querySelector<HTMLInputElement>("[data-group-icon-value]")?.value,
    ).toBe("");
  });

  test("an icon option WITH a glyph and value input selects it (positive control)", () => {
    const harness = mount(
      `<div class="group-icon-picker">
         <input type="hidden" data-group-icon-value value="folder" />
         <button id="a" data-group-icon="folder" aria-pressed="true" type="button"></button>
         <button id="b" data-group-icon="star" aria-pressed="false" type="button"></button>
       </div>`,
    );

    click(harness.container.querySelector("#b"));

    expect(
      harness.container.querySelector<HTMLInputElement>("[data-group-icon-value]")?.value,
    ).toBe("star");
    expect(harness.container.querySelector("#b")?.getAttribute("aria-pressed")).toBe("true");
    expect(harness.container.querySelector("#a")?.getAttribute("aria-pressed")).toBe("false");
  });

  test("remove/toggle/pick/assign/expand handlers bail on an empty dataset id", async () => {
    const harness = mount(
      `<button data-remove-group="" type="button"></button>
       <button data-group-toggle="" data-account="" type="button"></button>
       <button data-group-pick="work" type="button"></button>
       <button data-assign-toggle="" type="button"></button>
       <button data-group-expand="" type="button"></button>`,
    );

    click(harness.container.querySelector("[data-remove-group]"));
    click(harness.container.querySelector("[data-group-toggle]"));
    click(harness.container.querySelector("[data-group-pick]"));
    click(harness.container.querySelector("[data-assign-toggle]"));
    click(harness.container.querySelector("[data-group-expand]"));
    await tick();

    // Every handler returned before touching the wallet or transient state.
    expect(harness.calls.removeGroup).toEqual([]);
    expect(harness.calls.setAccountInGroup).toEqual([]);
    expect(harness.expanded).toEqual([]);
    expect(harness.openAssign).toEqual([]);
    expect(harness.rerenders).toBe(0);
  });
});

describe("bindGroupControls create form", () => {
  beforeEach(() => document.body.replaceChildren());

  const createMarkup = (name: string) =>
    `<form class="new-group-form">
       <input data-group-name value="${name}" />
       <input type="hidden" data-group-icon-value value="folder" />
       <button data-create-group type="submit"></button>
     </form>`;

  test("rejects an all-whitespace name without calling the wallet", async () => {
    const harness = mount(createMarkup("   "));
    submit(harness.container.querySelector(".new-group-form"));
    await tick();

    expect(harness.calls.createGroup).toEqual([]);
    expect(errorTexts()).toContain("Enter a group name");
  });

  test("re-enables the create button and toasts when the create op rejects", async () => {
    const harness = mount(createMarkup("Treasury"), true);
    const button = harness.container.querySelector<HTMLButtonElement>("[data-create-group]");
    submit(harness.container.querySelector(".new-group-form"));
    await tick();

    expect(harness.calls.createGroup).toEqual([["Treasury", "folder"]]);
    expect(hasErrorToast()).toBe(true);
    expect(button?.disabled).toBe(false);
  });
});

describe("bindGroupControls op rejection paths", () => {
  beforeEach(() => document.body.replaceChildren());

  test("edit form: a rename/icon failure re-enables the save button", async () => {
    const harness = mount(
      `<form class="edit-group-form" data-edit-group="work">
         <input data-group-name value="Work travel" />
         <input type="hidden" data-group-icon-value value="star" />
         <button data-save-group="work" type="submit"></button>
       </form>`,
      true,
    );
    const button = harness.container.querySelector<HTMLButtonElement>("[data-save-group]");
    submit(harness.container.querySelector(".edit-group-form"));
    await tick();

    expect(harness.calls.renameGroup).toEqual([["work", "Work travel"]]);
    expect(hasErrorToast()).toBe(true);
    expect(button?.disabled).toBe(false);
  });

  test("remove: two taps confirm, and a delete failure re-enables the control", async () => {
    const harness = mount(`<button data-remove-group="work" type="button"></button>`, true);
    const button = harness.container.querySelector<HTMLButtonElement>("[data-remove-group]");

    // First tap only arms the two-step confirmation (no wallet call yet).
    click(button);
    await tick();
    expect(harness.calls.removeGroup).toEqual([]);
    expect(button?.dataset["confirm"]).toBe("true");

    // Second tap confirms; the op rejects, so the control is re-enabled.
    click(button);
    await tick();
    expect(harness.calls.removeGroup).toEqual([["work"]]);
    expect(hasErrorToast()).toBe(true);
    expect(button?.disabled).toBe(false);
  });

  test("assign toggle: a membership failure re-enables the toggle", async () => {
    const harness = mount(
      `<button data-group-toggle="work" data-account="0x2a" aria-pressed="false" type="button"></button>`,
      true,
    );
    const button = harness.container.querySelector<HTMLButtonElement>("[data-group-toggle]");
    click(button);
    await tick();

    // aria-pressed was false, so the toggle asked to ADD membership.
    expect(harness.calls.setAccountInGroup).toEqual([["0x2a", "work", true]]);
    expect(hasErrorToast()).toBe(true);
    expect(button?.disabled).toBe(false);
  });

  test("folder picker: a move failure re-enables the option", async () => {
    const harness = mount(
      `<div class="group-toggle-list">
         <button data-group-pick="none" data-account="0x2a" aria-pressed="true" type="button"></button>
         <button data-group-pick="work" data-account="0x2a" aria-pressed="false" type="button"></button>
       </div>`,
      true,
    );
    const work = harness.container.querySelector<HTMLButtonElement>('[data-group-pick="work"]');
    click(work);
    await tick();

    // Picking a concrete folder files the account into it.
    expect(harness.calls.setAccountInGroup).toEqual([["0x2a", "work", true]]);
    expect(hasErrorToast()).toBe(true);
    expect(work?.disabled).toBe(false);
  });

  test("folder picker: an already-selected option is a no-op", async () => {
    const harness = mount(
      `<div class="group-toggle-list">
         <button data-group-pick="work" data-account="0x2a" aria-pressed="true" type="button"></button>
       </div>`,
    );
    click(harness.container.querySelector('[data-group-pick="work"]'));
    await tick();
    expect(harness.calls.setAccountInGroup).toEqual([]);
  });

  test("assign panel and group expander toggle their transient state open", async () => {
    const harness = mount(
      `<button data-assign-toggle="0x2a" type="button"></button>
       <button data-group-expand="work" type="button"></button>`,
    );
    click(harness.container.querySelector("[data-assign-toggle]"));
    click(harness.container.querySelector("[data-group-expand]"));
    await tick();

    expect(harness.openAssign).toEqual(["0x2a"]);
    expect(harness.expanded).toEqual(["work"]);
    expect(harness.rerenders).toBe(2);
  });
});
