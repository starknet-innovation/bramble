/**
 * Core UI-interaction coverage for the account-groups ("folders") binding chain:
 * it drives the real drawer and manage-accounts templates via the shared happy-dom
 * harness so each test asserts BOTH that the correct store method is called AND
 * that the UI re-derives from the mutated store. Covers the lean drawer (folder
 * sections, the seeded defaults, and the assertion that NO group-CRUD controls
 * render there) and the manage-accounts create / rename / change-icon / delete /
 * bucket flows plus the accordion. The drawer's drag-to-move and inline
 * add-folder live in ../../shell/sidepanel-drawer-folders.test.ts; edge cases
 * (self-heal, duplicates, cross-surface, focus) in ./sidepanel-groups-edge.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_GROUP_IDS } from "@bramble/settings/groups";
import { icon } from "../../../../src/sidepanel/shared/icons";
import {
  acctA,
  acctB,
  click,
  group,
  mount,
  registerDom,
  submit,
  unregisterDom,
} from "../../../support/groups-harness";

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
    // What the drawer does carry is the inline "Add folder" control.
    expect(harness.container.querySelector("#drawer-add-folder")).not.toBeNull();
  });

  test("lists each account under its own folder, and an unfiled one under My accounts", () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");

    // Every account is listed exactly once, no filter needed.
    expect(harness.container.querySelectorAll(".drawer-account-item").length).toBe(2);
    const work = harness.container.querySelector('[data-folder="work"]');
    expect(work?.querySelector(`[data-switch-account="${acctA.id}"]`)).not.toBeNull();
    expect(work?.querySelector(`[data-switch-account="${acctB.id}"]`)).toBeNull();

    // acctB is in no folder, so it falls to the home folder rather than vanishing.
    const home = harness.container.querySelector(`[data-folder="${DEFAULT_GROUP_IDS.home}"]`);
    expect(home?.querySelector(`[data-switch-account="${acctB.id}"]`)).not.toBeNull();
  });

  test("seeds My accounts and Archived accounts when the store holds no folders", () => {
    const harness = mount([], "drawer");

    // No inline create surface; management is reached through the entry row.
    expect(harness.container.querySelector(".new-group-form")).toBeNull();
    expect(harness.container.querySelector('.drawer-foot [data-view="account"]')).not.toBeNull();

    const folders = [...harness.container.querySelectorAll("[data-folder]")].map((section) =>
      section.getAttribute("data-folder"),
    );
    expect(folders).toEqual([DEFAULT_GROUP_IDS.home, DEFAULT_GROUP_IDS.archived]);
    // Both accounts land in the home folder; the archive starts empty.
    const archived = harness.container.querySelector(
      `[data-folder="${DEFAULT_GROUP_IDS.archived}"]`,
    );
    expect(archived?.querySelectorAll(".drawer-account-item").length).toBe(0);
    expect(archived?.textContent).toContain("Drag an account here.");
  });
});

describe("manage-accounts group management", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("lists the default folders on an empty wallet, and they cannot be deleted", () => {
    const harness = mount([], "account");

    const rows = [...harness.container.querySelectorAll("[data-group-expand]")].map((row) =>
      row.getAttribute("data-group-expand"),
    );
    expect(rows).toEqual(["__create__", DEFAULT_GROUP_IDS.home, DEFAULT_GROUP_IDS.archived]);
    expect(
      harness.container.querySelector(`[data-remove-group="${DEFAULT_GROUP_IDS.home}"]`),
    ).toBeNull();
    expect(
      harness.container.querySelector(`[data-remove-group="${DEFAULT_GROUP_IDS.archived}"]`),
    ).toBeNull();
    // Nothing stored yet, so the create panel stays closed beside the defaults.
    expect(harness.container.querySelector("#group-create-panel")?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  test("creates a group from the manage view's Create a group panel", async () => {
    const harness = mount([], "account");

    // Defaults are always listed, so the create panel starts closed. Opening it
    // is the one creation surface (never duplicated per account row).
    click(harness.container.querySelector('[data-group-expand="__create__"]'));
    await harness.tick();
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
    expect(harness.groupById("work")?.name).toBe("Payroll");
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
    expect(harness.groupById("work")?.icon).toBe("star");
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
    expect(harness.groupById("work")).toBeUndefined();
    expect(harness.container.querySelector('[data-group-expand="work"]')).toBeNull();
  });

  test("My accounts counts unfiled accounts, and clearing that row writes nothing", async () => {
    const harness = mount([group("folder", "work", "Work", [acctA.id])], "account");

    click(harness.container.querySelector(`[data-group-expand="${DEFAULT_GROUP_IDS.home}"]`));
    await harness.tick();

    const home = harness.container.querySelector(`[data-group-expand="${DEFAULT_GROUP_IDS.home}"]`);
    // acctA is filed in Work. acctB is unfiled, so it is shown here.
    expect(home?.textContent).toContain("1 account");
    const homeRow = (id: string) =>
      harness.container.querySelector<HTMLButtonElement>(
        `[data-group-toggle="${DEFAULT_GROUP_IDS.home}"][data-account="${id}"]`,
      );
    expect(homeRow(acctB.id)?.getAttribute("aria-pressed")).toBe("true");
    expect(homeRow(acctB.id)?.disabled).toBe(true);
    expect(homeRow(acctA.id)?.getAttribute("aria-pressed")).toBe("false");
    expect(homeRow(acctA.id)?.disabled).toBe(false);

    click(homeRow(acctB.id) ?? null);
    await harness.tick();
    expect(harness.calls.setAccountInGroup).toEqual([]);
    expect(homeRow(acctB.id)?.getAttribute("aria-pressed")).toBe("true");

    click(homeRow(acctA.id) ?? null);
    await harness.tick();
    expect(harness.calls.setAccountInGroup).toEqual([[acctA.id, DEFAULT_GROUP_IDS.home, true]]);
    expect(harness.groupById("work")?.accountIds).not.toContain(acctA.id);
    expect(homeRow(acctA.id)?.getAttribute("aria-pressed")).toBe("true");
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
    expect(harness.groupById("work")?.accountIds).toContain(acctA.id);
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
