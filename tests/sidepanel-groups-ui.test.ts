/**
 * Core UI-interaction coverage for the account-groups ("folders") binding chain:
 * it drives the real drawer and manage-accounts templates via the shared happy-dom
 * harness so each test asserts BOTH that the correct store method is called AND
 * that the UI re-derives from the mutated store. Covers the lean drawer (filter,
 * empty state, and the assertion that NO group-CRUD controls render there) and the
 * manage-accounts create / rename / change-icon / delete / bucket flows plus the
 * accordion. The drawer's single-group folder picker and Add-account-joins-the-
 * -folder live in ./sidepanel-groups-drawer-picker.test.ts; edge cases (self-heal,
 * duplicates, cross-surface, focus) in ./sidepanel-groups-edge.test.ts.
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

  test("renders no group-CRUD controls; management lives behind the Manage accounts & groups entry", () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    // The lean drawer carries none of the moved group-management UI: no create
    // form / icon grid / Create button, no inline group rows (expand/edit/delete),
    // and no "Manage groups" disclosure.
    expect(harness.container.querySelector(".new-group-form")).toBeNull();
    expect(harness.container.querySelector(".group-icon-picker")).toBeNull();
    expect(harness.container.querySelector("[data-create-group]")).toBeNull();
    expect(harness.container.querySelector("[data-group-expand]")).toBeNull();
    expect(harness.container.querySelector("[data-edit-group]")).toBeNull();
    expect(harness.container.querySelector("[data-remove-group]")).toBeNull();
    expect(harness.container.querySelector("#drawer-manage-groups")).toBeNull();
    expect(harness.container.querySelector("#drawer-manage-groups-panel")).toBeNull();

    // The single entry into management is the "Manage accounts & groups" row,
    // which navigates to the dedicated view (data-view="account").
    const entry = harness.container.querySelector('.drawer-foot [data-view="account"]');
    expect(entry).not.toBeNull();
    expect(entry?.textContent).toContain("Manage accounts");
    // The lean quick-assign picker (not "management") stays on each row.
    expect(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`)).not.toBeNull();
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

  test("shows an empty state with no chips and a Manage accounts & groups entry when there are no groups", () => {
    const harness = mount([], "drawer");

    expect(harness.container.querySelector(".group-chips")).toBeNull();
    // No inline create surface; management is reached through the entry row.
    expect(harness.container.querySelector(".new-group-form")).toBeNull();
    expect(harness.container.querySelector('.drawer-foot [data-view="account"]')).not.toBeNull();

    click(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`));
    const panel = harness.container.querySelector(`[data-group-assign="${acctA.id}"]`);
    expect(panel?.textContent).toContain("No groups yet");
    expect(panel?.textContent).toContain("Manage accounts");
  });
});

describe("manage-accounts group management", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("creates a group from the manage view's Create a group panel", async () => {
    const harness = mount([], "account");

    // With no groups yet the create panel starts open, so its single form is the
    // one creation surface (never duplicated per account row).
    expect(harness.container.querySelectorAll(".new-group-form").length).toBe(1);
    expect(harness.container.querySelector("#group-create-panel")?.hasAttribute("hidden")).toBe(
      false,
    );

    const form = harness.container.querySelector(".new-group-form");
    const nameInput = form?.querySelector<HTMLInputElement>("[data-group-name]");
    if (nameInput) {
      nameInput.value = "Trading";
    }
    click(form?.querySelector('[data-group-icon="rocket"]') ?? null);
    submit(form);
    await harness.tick();

    expect(harness.calls.createGroup).toEqual([["Trading", "rocket"]]);
    // UI re-derives: the new group surfaces as an editable row with its editor
    // open (ready to rename/re-icon/bucket), and the create panel collapses.
    expect(harness.container.querySelector('[data-group-expand="trading"]')).not.toBeNull();
    expect(harness.container.querySelector("#group-editor-trading")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(harness.container.querySelector("#group-create-panel")?.hasAttribute("hidden")).toBe(
      true,
    );
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

  test("accordion: opening group B collapses the already-open group A", async () => {
    const harness = mount(
      [group("folder", "work", "Work"), group("piggyBank", "savings", "Savings")],
      "account",
    );

    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();
    expect(harness.container.querySelector("#group-editor-work")?.hasAttribute("hidden")).toBe(
      false,
    );

    // Opening Savings must close Work — only one panel expanded at a time.
    click(harness.container.querySelector('[data-group-expand="savings"]'));
    await harness.tick();
    expect(harness.container.querySelector("#group-editor-savings")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(harness.container.querySelector("#group-editor-work")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(
      harness.container.querySelector('[data-group-expand="work"]')?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  test("accordion: opening a group collapses the Create a group panel and vice versa", async () => {
    const harness = mount([group("folder", "work", "Work")], "account");

    // With a group present the create panel starts collapsed.
    expect(harness.container.querySelector("#group-create-panel")?.hasAttribute("hidden")).toBe(
      true,
    );

    // Opening the create panel leaves the group collapsed.
    click(harness.container.querySelector('[data-group-expand="__create__"]'));
    await harness.tick();
    expect(harness.container.querySelector("#group-create-panel")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(harness.container.querySelector("#group-editor-work")?.hasAttribute("hidden")).toBe(
      true,
    );

    // Opening the group collapses the create panel — one open panel, no pile-up.
    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();
    expect(harness.container.querySelector("#group-editor-work")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(harness.container.querySelector("#group-create-panel")?.hasAttribute("hidden")).toBe(
      true,
    );
  });
});
