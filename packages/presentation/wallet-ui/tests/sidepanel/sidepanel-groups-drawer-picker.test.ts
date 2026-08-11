/**
 * Drawer per-row folder picker (the single-group "tap-to-pick" fix) plus the
 * "Add account joins the focused folder" fix. Drives the real drawer template
 * and bindings through the shared happy-dom harness, asserting BOTH the store
 * call and the re-derived DOM: filing an account into a folder, exclusivity when
 * moving to a second folder, clearing to None, the folder-picker icon reflecting
 * the folder without a redundant metadata icon, and Add account joining the
 * active chip (or nothing on All). The
 * folder-management journeys (create/rename/icon/delete) stay in
 * ./sidepanel-groups-ui.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { acctA, click, group, mount, registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("account drawer folder picker", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("tap-to-pick files an account into a folder and shows its icon on the row", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    // The row icon starts as the muted "no folder" affordance.
    const rowButton = () =>
      harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`) as HTMLElement | null;
    expect(rowButton()?.classList.contains("is-ungrouped")).toBe(true);

    click(rowButton());
    await harness.tick();
    const panel = harness.container.querySelector(`[data-group-assign="${acctA.id}"]`);
    expect(panel?.hasAttribute("hidden")).toBe(false);

    click(harness.container.querySelector(`[data-group-pick="work"][data-account="${acctA.id}"]`));
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([[acctA.id, "work", true]]);
    // Store now has the account filed under Work; the pick re-derives selected,
    // and the row icon becomes the group's glyph (no longer the muted folder).
    expect(harness.groups()[0]?.accountIds).toContain(acctA.id);
    expect(
      harness.container
        .querySelector(`[data-group-pick="work"][data-account="${acctA.id}"]`)
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(rowButton()?.classList.contains("is-ungrouped")).toBe(false);
    // The row icon is now Work's glyph — identical markup to Work's filter chip.
    expect(rowButton()?.querySelector(".icon")?.outerHTML).toBe(
      harness.container.querySelector('[data-group-filter="work"] .icon')?.outerHTML,
    );
    const row = harness.container
      .querySelector(`[data-switch-account="${acctA.id}"]`)
      ?.closest(".drawer-account-item");
    expect(row?.querySelector(".account-groups-line")).toBeNull();
  });

  test("moving to a second folder is exclusive and keeps the picker open", async () => {
    const harness = mount(
      [group("briefcase", "work", "Work"), group("piggyBank", "savings", "Savings")],
      "drawer",
    );

    click(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`));
    await harness.tick();

    click(harness.container.querySelector(`[data-group-pick="work"][data-account="${acctA.id}"]`));
    await harness.tick();
    // Picker stays open after the first pick.
    expect(
      harness.container.querySelector(`[data-group-assign="${acctA.id}"]`)?.hasAttribute("hidden"),
    ).toBe(false);

    click(
      harness.container.querySelector(`[data-group-pick="savings"][data-account="${acctA.id}"]`),
    );
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([
      [acctA.id, "work", true],
      [acctA.id, "savings", true],
    ]);
    // Exclusive: the account left Work when filed into Savings.
    expect(harness.groups()[0]?.accountIds).not.toContain(acctA.id);
    expect(harness.groups()[1]?.accountIds).toContain(acctA.id);
    // The row icon now reflects Savings (matches the Savings chip), and the
    // picker is still open.
    expect(
      (
        harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`) as HTMLElement
      )?.querySelector(".icon")?.outerHTML,
    ).toBe(harness.container.querySelector('[data-group-filter="savings"] .icon')?.outerHTML);
    expect(
      harness.container.querySelector(`[data-group-assign="${acctA.id}"]`)?.hasAttribute("hidden"),
    ).toBe(false);
  });

  test("choosing None clears the account's folder", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");

    click(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`));
    await harness.tick();
    click(harness.container.querySelector(`[data-group-pick="none"][data-account="${acctA.id}"]`));
    await harness.tick();

    // None removes the account from its current folder (member: false).
    expect(harness.calls.setAccountInGroup).toEqual([[acctA.id, "work", false]]);
    expect(harness.groups()[0]?.accountIds).not.toContain(acctA.id);
    expect(
      (
        harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`) as HTMLElement
      )?.classList.contains("is-ungrouped"),
    ).toBe(true);
  });

  test("Add account opens the shared chooser instead of deriving inside the drawer", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    click(harness.container.querySelector('[data-group-filter="work"]'));
    await harness.tick();
    click(harness.container.querySelector("#drawer-add-account"));
    await harness.tick();

    expect(harness.calls.startAddAccount).toBe(1);
    expect(harness.calls.addAccount).toEqual([]);
    expect(harness.calls.setAccountInGroup).toEqual([]);
  });

  test("Add account uses the same chooser when the filter is All", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    click(harness.container.querySelector("#drawer-add-account"));
    await harness.tick();

    expect(harness.calls.startAddAccount).toBe(1);
    expect(harness.calls.addAccount).toEqual([]);
    expect(harness.calls.setAccountInGroup).toEqual([]);
  });
});
