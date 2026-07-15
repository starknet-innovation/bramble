/**
 * Core UI-interaction coverage for the account-groups ("folders") binding chain:
 * it drives the real drawer and manage-accounts templates via the shared happy-dom
 * harness so each test asserts BOTH that the correct store method is called AND
 * that the UI re-derives from the mutated store. Covers create from the drawer,
 * filter, the empty state, and the manage-accounts rename / change-icon / delete /
 * bucket flows. The drawer's single-group folder picker and Add-account-joins-the-
 * -folder live in ./sidepanel-groups-drawer-picker.test.ts; edge cases (the drawer
 * edit path, self-heal, duplicates, cross-surface, focus) in
 * ./sidepanel-groups-edge.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { icon } from "../src/sidepanel/icons";
import {
  acctA,
  acctB,
  click,
  group,
  mount,
  registerDom,
  submit,
  unregisterDom,
} from "./support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("account drawer group interactions", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("creates a group from the drawer's Manage groups disclosure", async () => {
    const harness = mount([], "drawer");

    // The single create form is discoverable under the foot disclosure even with
    // zero groups, and is NOT duplicated per account row.
    expect(harness.container.querySelectorAll(".new-group-form").length).toBe(1);
    expect(
      harness.container.querySelector("#drawer-manage-groups-panel")?.hasAttribute("hidden"),
    ).toBe(true);

    click(harness.container.querySelector("#drawer-manage-groups"));
    await harness.tick();
    expect(
      harness.container.querySelector("#drawer-manage-groups-panel")?.hasAttribute("hidden"),
    ).toBe(false);

    const form = harness.container.querySelector(".new-group-form");
    const nameInput = form?.querySelector<HTMLInputElement>("[data-group-name]");
    if (nameInput) {
      nameInput.value = "Trading";
    }
    click(form?.querySelector('[data-group-icon="rocket"]') ?? null);
    submit(form);
    await harness.tick();

    expect(harness.calls.createGroup).toEqual([["Trading", "rocket"]]);
    // UI re-derives: the new group surfaces as a filter chip and, because the
    // disclosure stays open, as an editable row with its inline editor expanded
    // so the user can immediately rename/re-icon/delete it.
    expect(harness.container.querySelector('[data-group-filter="trading"]')).not.toBeNull();
    expect(
      harness.container.querySelector("#drawer-manage-groups-panel")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(harness.container.querySelector('[data-group-expand="trading"]')).not.toBeNull();
    expect(
      harness.container.querySelector("#drawer-group-editor-trading")?.hasAttribute("hidden"),
    ).toBe(false);
  });

  test("filters the account list by group", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");

    // All accounts visible before filtering.
    expect(harness.container.querySelectorAll(".drawer-account-item").length).toBe(2);

    click(harness.container.querySelector('[data-group-filter="work"]'));
    await harness.tick();

    const rows = harness.container.querySelectorAll(".drawer-account-item");
    expect(rows.length).toBe(1);
    expect(harness.container.querySelector(`[data-switch-account="${acctA.id}"]`)).not.toBeNull();
    expect(harness.container.querySelector(`[data-switch-account="${acctB.id}"]`)).toBeNull();
  });

  test("shows an empty state with no chips and a Manage groups entry when there are no groups", () => {
    const harness = mount([], "drawer");

    expect(harness.container.querySelector(".group-chips")).toBeNull();
    expect(harness.container.querySelector("#drawer-manage-groups")).not.toBeNull();

    click(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`));
    const panel = harness.container.querySelector(`[data-group-assign="${acctA.id}"]`);
    expect(panel?.textContent).toContain("No groups yet");
  });
});

describe("manage-accounts group management", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("renames a group from the bulk editor", async () => {
    const harness = mount([group("folder", "work", "Work")], "account");

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
    expect(harness.container.querySelector('[data-group-expand="work"]')?.textContent).toContain(
      "Payroll",
    );
  });

  test("changes a group's icon and renders the new icon everywhere", async () => {
    const harness = mount([group("folder", "work", "Work")], "account");

    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();

    const form = harness.container.querySelector('[data-edit-group="work"]');
    click(form?.querySelector('[data-group-icon="star"]') ?? null);
    // The picker reflects the pending choice before saving.
    expect(form?.querySelector('[data-group-icon="star"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    submit(form);
    await harness.tick();

    expect(harness.calls.setGroupIcon).toEqual([["work", "star"]]);
    expect(harness.groups()[0]?.icon).toBe("star");
    // The group's header now renders the star glyph, not the old folder glyph
    // (compared normalized through the DOM so serialization differences vanish).
    const header = harness.container.querySelector('[data-group-expand="work"]');
    const starProbe = document.createElement("span");
    starProbe.append(document.createRange().createContextualFragment(icon("star")));
    const folderProbe = document.createElement("span");
    folderProbe.append(document.createRange().createContextualFragment(icon("folder")));
    const rendered = header?.querySelector(".group-manage-icon")?.innerHTML;
    expect(rendered).toBe(starProbe.innerHTML);
    expect(rendered).not.toBe(folderProbe.innerHTML);
  });

  test("requires a second tap to delete a group", async () => {
    const harness = mount([group("folder", "work", "Work")], "account");

    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();

    const removeButton = harness.container.querySelector('[data-remove-group="work"]');
    click(removeButton);
    await harness.tick();
    // First tap only arms the confirm — nothing is deleted yet.
    expect(harness.calls.removeGroup).toEqual([]);
    expect(removeButton?.classList.contains("is-confirming")).toBe(true);

    click(removeButton);
    await harness.tick();
    expect(harness.calls.removeGroup).toEqual(["work"]);
    expect(harness.groups().length).toBe(0);
    expect(harness.container.querySelector('[data-group-expand="work"]')).toBeNull();
  });

  test("buckets an account into a group from the members checklist", async () => {
    const harness = mount([group("folder", "work", "Work")], "account");

    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();

    click(
      harness.container.querySelector(`[data-group-toggle="work"][data-account="${acctA.id}"]`),
    );
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([[acctA.id, "work", true]]);
    expect(harness.groups()[0]?.accountIds).toContain(acctA.id);
  });
});
