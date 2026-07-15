/**
 * Edge-case coverage for the account-groups ("folders") UI, complementing the
 * core journeys in ./sidepanel-groups-ui.test.ts. Uses the same shared harness so
 * every assertion checks both the store call and the re-derived DOM. Covers the
 * drawer's group-edit path (rename / change-icon / delete), membership toggle-OFF,
 * self-heal of the active filter when its group is deleted, duplicate names,
 * rename-to-empty rejection, cross-surface icon propagation, the NEGATIVE Journey
 * 3 assertion (no per-account assign panel on the manage flow), and focus
 * restoration across the full-repaint that each mutation triggers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { accountDrawer } from "../src/sidepanel/account-drawer";
import {
  captureRepaintFocus,
  focusMemo,
  restoreFocus,
  restoreRepaintFocus,
} from "../src/sidepanel/dom";
import { type IconName, icon } from "../src/sidepanel/icons";
import type { AccountGroups } from "../src/storage/account-groups";
import {
  acctA,
  acctB,
  click,
  group,
  mount,
  registerDom,
  status,
  submit,
  unregisterDom,
} from "./support/groups-harness";
import { preferences } from "./support/sidepanel-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);

// Reads a rendered `.icon` glyph's markup so it can be compared against a probe,
// normalizing away serialization differences.
const glyphHtml = (glyph: IconName): string => {
  const probe = document.createElement("span");
  probe.append(document.createRange().createContextualFragment(icon(glyph)));
  return probe.querySelector(".icon")?.outerHTML ?? "";
};

describe("account drawer group-edit path", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("renames a group from the drawer's Manage groups list in two taps", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    // Two taps reach the edit affordance: open the disclosure, expand the group.
    click(harness.container.querySelector("#drawer-manage-groups"));
    await harness.tick();
    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();

    const form = harness.container.querySelector('[data-edit-group="work"]');
    const nameInput = form?.querySelector<HTMLInputElement>("[data-group-name]");
    if (nameInput) {
      nameInput.value = "Payroll";
    }
    submit(form);
    await harness.tick();

    expect(harness.calls.renameGroup).toEqual([["work", "Payroll"]]);
    expect(harness.groups()[0]?.name).toBe("Payroll");
    // The drawer re-derives: the group's row and its filter chip show the new name.
    expect(harness.container.querySelector('[data-group-expand="work"]')?.textContent).toContain(
      "Payroll",
    );
    expect(harness.container.querySelector('[data-group-filter="work"]')?.textContent).toContain(
      "Payroll",
    );
  });

  test("changes a group's icon from the drawer's Manage groups list", async () => {
    const harness = mount([group("folder", "work", "Work")], "drawer");

    click(harness.container.querySelector("#drawer-manage-groups"));
    await harness.tick();
    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();

    const form = harness.container.querySelector('[data-edit-group="work"]');
    click(form?.querySelector('[data-group-icon="rocket"]') ?? null);
    submit(form);
    await harness.tick();

    expect(harness.calls.setGroupIcon).toEqual([["work", "rocket"]]);
    expect(harness.groups()[0]?.icon).toBe("rocket");
    // The filter chip re-derives the new glyph — the drawer can now change a
    // group's icon, the original "icons don't change" complaint.
    const chipGlyph = harness.container
      .querySelector('[data-group-filter="work"]')
      ?.querySelector(".icon");
    expect(chipGlyph?.outerHTML).toBe(glyphHtml("rocket"));
  });

  test("deletes a group from the drawer's Manage groups list with a two-tap confirm", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    click(harness.container.querySelector("#drawer-manage-groups"));
    await harness.tick();
    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();

    const removeButton = harness.container.querySelector('[data-remove-group="work"]');
    click(removeButton);
    await harness.tick();
    // First tap only arms the confirm.
    expect(harness.calls.removeGroup).toEqual([]);
    expect(removeButton?.classList.contains("is-confirming")).toBe(true);

    click(removeButton);
    await harness.tick();
    expect(harness.calls.removeGroup).toEqual(["work"]);
    expect(harness.groups().length).toBe(0);
    // The chip row disappears; the disclosure stays open with only the create form.
    expect(harness.container.querySelector(".group-chips")).toBeNull();
    expect(harness.container.querySelectorAll(".new-group-form").length).toBe(1);
  });

  test("picking None clears the account's folder while the picker stays open", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");

    click(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`));
    await harness.tick();
    // The account starts filed under Work: its row shows the folder icon line
    // and the Work option is the selected pick.
    let row = harness.container
      .querySelector(`[data-switch-account="${acctA.id}"]`)
      ?.closest(".drawer-account-item");
    expect(row?.querySelector(".account-groups-line")).not.toBeNull();
    expect(
      harness.container
        .querySelector(`[data-group-pick="work"][data-account="${acctA.id}"]`)
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    click(harness.container.querySelector(`[data-group-pick="none"][data-account="${acctA.id}"]`));
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([[acctA.id, "work", false]]);
    expect(harness.groups()[0]?.accountIds).not.toContain(acctA.id);
    // None is now the selected pick, the row's icon line is gone, and the picker
    // is still open.
    expect(
      harness.container
        .querySelector(`[data-group-pick="none"][data-account="${acctA.id}"]`)
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    row = harness.container
      .querySelector(`[data-switch-account="${acctA.id}"]`)
      ?.closest(".drawer-account-item");
    expect(row?.querySelector(".account-groups-line")).toBeNull();
    expect(
      harness.container.querySelector(`[data-group-assign="${acctA.id}"]`)?.hasAttribute("hidden"),
    ).toBe(false);
  });

  test("deleting the active-filter group self-heals the filter back to All", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");

    click(harness.container.querySelector('[data-group-filter="work"]'));
    await harness.tick();
    // Filtered to Work: only acctA is listed.
    expect(harness.container.querySelectorAll(".drawer-account-item").length).toBe(1);

    click(harness.container.querySelector("#drawer-manage-groups"));
    await harness.tick();
    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();
    const removeButton = harness.container.querySelector('[data-remove-group="work"]');
    click(removeButton);
    await harness.tick();
    click(removeButton);
    await harness.tick();

    expect(harness.calls.removeGroup).toEqual(["work"]);
    // Filter self-heals to All (no group left): every account is visible again
    // and the chip row is gone.
    expect(harness.container.querySelector(".group-chips")).toBeNull();
    expect(harness.container.querySelectorAll(".drawer-account-item").length).toBe(2);
    expect(harness.container.querySelector(`[data-switch-account="${acctB.id}"]`)).not.toBeNull();
  });

  test("creates distinct ids for duplicate group names", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    click(harness.container.querySelector("#drawer-manage-groups"));
    await harness.tick();

    const form = harness.container.querySelector(".new-group-form");
    const nameInput = form?.querySelector<HTMLInputElement>("[data-group-name]");
    if (nameInput) {
      nameInput.value = "Work";
    }
    submit(form);
    await harness.tick();

    expect(harness.calls.createGroup).toEqual([["Work", "folder"]]);
    // Same display name, deterministic collision-free ids.
    expect(harness.groups().map((entry) => entry.id)).toEqual(["work", "work-2"]);
    expect(harness.groups().map((entry) => entry.name)).toEqual(["Work", "Work"]);
  });
});

describe("manage-accounts group edge cases", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("rejects a rename to whitespace without mutating the group", async () => {
    const harness = mount([group("folder", "work", "Work")], "account");

    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();

    const form = harness.container.querySelector('[data-edit-group="work"]');
    const nameInput = form?.querySelector<HTMLInputElement>("[data-group-name]");
    if (nameInput) {
      nameInput.value = "   ";
    }
    submit(form);
    await harness.tick();

    // The empty name is rejected before any store call; the group is unchanged.
    expect(harness.calls.renameGroup).toEqual([]);
    expect(harness.calls.setGroupIcon).toEqual([]);
    expect(harness.groups()[0]?.name).toBe("Work");
  });

  test("propagates an icon change made in the manage view to the drawer chip", async () => {
    const harness = mount([group("folder", "work", "Work")], "account");

    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();
    const form = harness.container.querySelector('[data-edit-group="work"]');
    click(form?.querySelector('[data-group-icon="star"]') ?? null);
    submit(form);
    await harness.tick();
    expect(harness.groups()[0]?.icon).toBe("star");

    // Render the drawer from the same mutated store: its filter chip re-derives
    // the new glyph, proving the change is visible cross-surface.
    const probe = document.createElement("div");
    probe.append(
      document
        .createRange()
        .createContextualFragment(
          accountDrawer(status, acctA, { ...preferences, groups: harness.groups() }),
        ),
    );
    const chipGlyph = probe.querySelector('[data-group-filter="work"]')?.querySelector(".icon");
    expect(chipGlyph?.outerHTML).toBe(glyphHtml("star"));
  });

  test("does not render the old per-account assign panel on the manage-accounts flow", () => {
    const harness = mount([group("folder", "work", "Work", [acctA.id])], "account");

    // Journey 3 has a single membership surface (the group-centric checklist);
    // the duplicate per-account assign toggle/panel must be absent here.
    expect(harness.container.querySelector("[data-assign-toggle]")).toBeNull();
    expect(harness.container.querySelector("[data-group-assign]")).toBeNull();
    // The group-centric bulk editor is still present as the one membership surface.
    expect(harness.container.querySelector('[data-group-expand="work"]')).not.toBeNull();
  });
});

describe("group control focus restoration", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  // Builds a fresh #app whose children are (re)set from markup without innerHTML,
  // so each paint yields new nodes exactly like the real shell swap.
  const paintApp = (html: string): HTMLElement => {
    let app = document.querySelector<HTMLElement>("#app");
    if (!app) {
      app = document.createElement("div");
      app.id = "app";
      document.body.append(app);
    }
    app.replaceChildren(document.createRange().createContextualFragment(html));
    return app;
  };

  const drawer = (groups: AccountGroups, openAssign: string | null, expanded: string | null) =>
    accountDrawer(status, acctA, { ...preferences, groups }, null, openAssign, true, expanded);

  test("reclaims focus on the acted-on folder pick after a repaint", () => {
    const groups = [group("briefcase", "work", "Work")];
    const app = paintApp(drawer(groups, acctA.id, null));
    const selector = `[data-group-pick="work"][data-account="${acctA.id}"]`;
    app.querySelector<HTMLElement>(selector)?.focus();
    const memo = focusMemo();

    // Repaint: the pick is now a fresh node. Focus must return to it.
    paintApp(drawer(groups, acctA.id, null));
    restoreFocus(app, memo);
    expect(document.activeElement).toBe(app.querySelector(selector));
  });

  test("falls back to a successor when the acted-on delete control is removed", () => {
    const groups = [group("briefcase", "work", "Work"), group("piggyBank", "savings", "Savings")];
    const app = paintApp(drawer(groups, null, "work"));
    app.querySelector<HTMLElement>('[data-remove-group="work"]')?.focus();
    const memo = focusMemo();

    // The group is deleted, so neither its remove button nor its expander exist
    // on the repaint; focus falls through to the next group's expander.
    const remaining = [group("piggyBank", "savings", "Savings")];
    paintApp(drawer(remaining, null, null));
    restoreFocus(app, memo);
    expect(document.activeElement).toBe(app.querySelector('[data-group-expand="savings"]'));
  });

  test("does not move focus when no tracked control was focused", () => {
    const groups = [group("briefcase", "work", "Work")];
    const app = paintApp(drawer(groups, null, null));
    // Nothing group-related is focused (a non-user/streaming repaint case).
    const memo = focusMemo();
    expect(memo).toEqual([]);

    paintApp(drawer(groups, null, null));
    const before = document.activeElement;
    restoreFocus(app, memo);
    // Focus is untouched — restoration never steals onto a group control.
    expect(document.activeElement).toBe(before);
  });

  test("keeps in-progress rename text, focus, and caret across a repaint", () => {
    const groups = [group("briefcase", "work", "Work")];
    // The "work" group's inline editor is open, so the rename field renders seeded
    // with the stored name "Work".
    const app = paintApp(drawer(groups, null, "work"));
    const selector = '[data-edit-group="work"] [data-group-name]';
    const input = app.querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error("rename field missing");
    }
    input.focus();
    // The user has typed past the stored value but not yet saved.
    input.value = "Work travel";
    input.setSelectionRange(11, 11);
    const focus = captureRepaintFocus();

    // A streaming repaint tears the field down and re-renders it from the
    // unchanged stored value ("Work"); focus + text must be reinstated.
    paintApp(drawer(groups, null, "work"));
    restoreRepaintFocus(app, focus);

    const after = app.querySelector<HTMLInputElement>(selector);
    expect(document.activeElement).toBe(after);
    // The typed-but-unsaved text survives — restoring focus alone would have
    // reset the field to "Work".
    expect(after?.value).toBe("Work travel");
    expect(after?.selectionStart).toBe(11);
  });
});
