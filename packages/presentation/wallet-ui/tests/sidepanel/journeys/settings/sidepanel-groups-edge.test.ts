/**
 * Edge-case coverage for the account-groups ("folders") UI, complementing the
 * core journeys in ./sidepanel-groups-ui.test.ts. Uses the same shared harness so
 * every assertion checks both the store call and the re-derived DOM. Covers the
 * drawer's fallback to the home folder when a folder is deleted from the manage
 * view, the drawer carrying no group-CRUD of its own, duplicate names,
 * rename-to-empty rejection, cross-surface icon propagation, the NEGATIVE Journey
 * 3 assertion (no per-account assign panel on the manage flow), and focus
 * restoration across the full-repaint that each mutation triggers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type AccountGroups, DEFAULT_GROUP_IDS } from "@bramble/settings/groups";
import { preferences } from "@bramble/testkit/sidepanel";
import {
  captureRepaintFocus,
  focusMemo,
  restoreFocus,
  restoreRepaintFocus,
} from "../../../../src/sidepanel/app/rendering/focus-memo";
import { accountFlow } from "../../../../src/sidepanel/app/screens/flows";
import { type IconName, icon } from "../../../../src/sidepanel/shared/icons";
import { accountDrawer } from "../../../../src/sidepanel/shell/account-drawer";
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
} from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// Reads a rendered `.icon` glyph's markup so it can be compared against a probe,
// normalizing away serialization differences.
const glyphHtml = (glyph: IconName): string => {
  const probe = document.createElement("span");
  probe.append(document.createRange().createContextualFragment(icon(glyph)));
  return probe.querySelector(".icon")?.outerHTML ?? "";
};

describe("account drawer folder edge cases", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("deleting a folder re-files its accounts under My accounts", async () => {
    // Delete the group through the manage view (the one place that deletes), then
    // prove the re-derived drawer still lists every account: an account whose
    // folder is gone falls back to the home folder rather than disappearing.
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "account");

    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();
    const removeButton = harness.container.querySelector('[data-remove-group="work"]');
    click(removeButton);
    await harness.tick();
    click(removeButton);
    await harness.tick();

    expect(harness.calls.removeGroup).toEqual(["work"]);
    expect(harness.groupById("work")).toBeUndefined();

    const rendered = document
      .createRange()
      .createContextualFragment(
        accountDrawer(status, acctA, { ...preferences, groups: harness.groups() }),
      );
    expect(rendered.querySelectorAll(".drawer-account-item").length).toBe(2);
    expect(rendered.querySelector(`[data-switch-account="${acctB.id}"]`)).not.toBeNull();
    // Both rows sit under the seeded home folder, which is never deletable.
    const home = rendered.querySelector(`[data-folder="${DEFAULT_GROUP_IDS.home}"]`);
    expect(home?.querySelectorAll(".drawer-account-item").length).toBe(2);
  });

  test("keeps hidden accounts out of the drawer's account list", () => {
    const rendered = document
      .createRange()
      .createContextualFragment(
        accountDrawer(status, acctA, { ...preferences, hiddenAccountIds: [acctB.id] }),
      );

    // The wallet still holds the account; the drawer just stops listing it, so
    // hiding is not a removal and nothing on this surface offers to reveal it.
    expect(rendered.querySelectorAll(".drawer-account-item").length).toBe(1);
    expect(rendered.querySelector(`[data-switch-account="${acctB.id}"]`)).toBeNull();
    expect(rendered.querySelector(`[data-switch-account="${acctA.id}"]`)).not.toBeNull();
  });

  test("the drawer keeps no group-CRUD controls of its own", () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");

    // Renaming, re-iconing and deleting a folder all live on the manage view; the
    // drawer only lists, moves by drag, and adds.
    expect(harness.container.querySelector("[data-remove-group]")).toBeNull();
    expect(harness.container.querySelector("[data-edit-group]")).toBeNull();
    expect(harness.container.querySelector("#drawer-add-folder")).not.toBeNull();
  });
});

describe("manage-accounts group edge cases", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("creates distinct ids for duplicate group names", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "account");

    // Open the "Create a folder" accordion panel, then create a second "Work".
    click(harness.container.querySelector('[data-group-expand="__create__"]'));
    await harness.tick();

    const form = harness.container.querySelector(".new-group-form");
    const nameInput = form?.querySelector<HTMLInputElement>("[data-group-name]");
    if (nameInput) {
      nameInput.value = "Work";
    }
    submit(form);
    await harness.tick();

    expect(harness.calls.createGroup).toEqual([["Work", "folder"]]);
    // Same display name, deterministic collision-free ids — between the two
    // default folders, which the write path seeds.
    expect(harness.groups().map((entry) => entry.id)).toEqual([
      DEFAULT_GROUP_IDS.home,
      "work",
      "work-2",
      DEFAULT_GROUP_IDS.archived,
    ]);
    expect(harness.groupById("work-2")?.name).toBe("Work");
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
    expect(harness.groupById("work")?.name).toBe("Work");
  });

  test("propagates an icon change made in the manage view to the drawer folder", async () => {
    const harness = mount([group("folder", "work", "Work")], "account");

    click(harness.container.querySelector('[data-group-expand="work"]'));
    await harness.tick();
    const form = harness.container.querySelector('[data-edit-group="work"]');
    click(form?.querySelector('[data-group-icon="star"]') ?? null);
    submit(form);
    await harness.tick();
    expect(harness.groupById("work")?.icon).toBe("star");

    // Render the drawer from the same mutated store: its folder heading
    // re-derives the new glyph, proving the change is visible cross-surface.
    const probe = document.createElement("div");
    probe.append(
      document
        .createRange()
        .createContextualFragment(
          accountDrawer(status, acctA, { ...preferences, groups: harness.groups() }),
        ),
    );
    const headGlyph = probe
      .querySelector('[data-folder="work"] .drawer-folder-icon')
      ?.querySelector(".icon");
    expect(headGlyph?.outerHTML).toBe(glyphHtml("star"));
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

  // The lean drawer (folder sections) and the manage view (group editors).
  const drawer = (groups: AccountGroups) =>
    accountDrawer(status, acctA, { ...preferences, groups });
  const manage = (groups: AccountGroups, expanded: string | null) =>
    accountFlow(status, { ...preferences, groups }, expanded);

  test("reclaims focus on the acted-on membership toggle after a repaint", () => {
    const groups = [group("briefcase", "work", "Work")];
    const app = paintApp(manage(groups, "work"));
    const selector = `[data-group-toggle="work"][data-account="${acctA.id}"]`;
    app.querySelector<HTMLElement>(selector)?.focus();
    const memo = focusMemo();

    // Repaint: the toggle is now a fresh node. Focus must return to it.
    paintApp(manage(groups, "work"));
    restoreFocus(app, memo);
    expect(document.activeElement).toBe(app.querySelector(selector));
  });

  test("falls back to a successor when the acted-on delete control is removed", () => {
    const groups = [group("briefcase", "work", "Work"), group("piggyBank", "savings", "Savings")];
    const app = paintApp(manage(groups, "work"));
    app.querySelector<HTMLElement>('[data-remove-group="work"]')?.focus();
    const memo = focusMemo();

    // The group is deleted, so neither its remove button nor its expander exist
    // on the repaint. Focus falls through to the first remaining folder, which
    // is My accounts — it is always on this screen, ahead of any user folder.
    const remaining = [group("piggyBank", "savings", "Savings")];
    paintApp(manage(remaining, null));
    restoreFocus(app, memo);
    expect(document.activeElement).toBe(
      app.querySelector(`[data-group-expand="${DEFAULT_GROUP_IDS.home}"]`),
    );
  });

  test("does not move focus when no tracked control was focused", () => {
    const groups = [group("briefcase", "work", "Work")];
    const app = paintApp(drawer(groups));
    // Nothing group-related is focused (a non-user/streaming repaint case).
    const memo = focusMemo();
    expect(memo).toEqual([]);

    paintApp(drawer(groups));
    const before = document.activeElement;
    restoreFocus(app, memo);
    // Focus is untouched — restoration never steals onto a group control.
    expect(document.activeElement).toBe(before);
  });

  test("keeps in-progress rename text, focus, and caret across a repaint", () => {
    const groups = [group("briefcase", "work", "Work")];
    // The "work" group's inline editor is open, so the rename field renders seeded
    // with the stored name "Work".
    const app = paintApp(manage(groups, "work"));
    const selector = '[data-edit-group="work"] [data-group-name]';
    const input = app.querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error("rename field missing");
    }
    input.focus();
    // The user has typed past the stored value but not yet saved.
    input.value = "Work travel";
    input.setSelectionRange(11, 11);
    document.documentElement.scrollTop = 184;
    const focus = captureRepaintFocus();

    // A streaming repaint tears the field down and re-renders it from the
    // unchanged stored value ("Work"); focus + text must be reinstated.
    paintApp(manage(groups, "work"));
    document.documentElement.scrollTop = 0;
    restoreRepaintFocus(app, focus);

    const after = app.querySelector<HTMLInputElement>(selector);
    expect(document.activeElement).toBe(after);
    // The typed-but-unsaved text survives — restoring focus alone would have
    // reset the field to "Work".
    expect(after?.value).toBe("Work travel");
    expect(after?.selectionStart).toBe(11);
    expect(document.documentElement.scrollTop).toBe(184);
  });

  test("keeps a body-scrolled onboarding surface in place across repaint", () => {
    // Onboarding makes body the scroller (html is overflow: hidden), so the
    // viewport scrollingElement reads 0 while body holds the real offset.
    const app = paintApp("<p>onboarding</p>");
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 96;
    const focus = captureRepaintFocus();

    paintApp("<p>onboarding</p>");
    document.body.scrollTop = 0;
    restoreRepaintFocus(app, focus);

    expect(focus.scrollTop).toBe(96);
    expect(document.body.scrollTop).toBe(96);
    document.body.scrollTop = 0;
  });

  test("keeps a non-secret transaction draft but never carries a passphrase across repaint", () => {
    const app = paintApp(
      '<input name="amount" value="0"><input name="vaultPassphrase" type="password" value="">',
    );
    const amount = app.querySelector<HTMLInputElement>('[name="amount"]');
    if (!amount) throw new Error("amount field missing");
    amount.value = "1.250";
    amount.focus();
    amount.setSelectionRange(5, 5);
    const amountFocus = captureRepaintFocus();

    paintApp(
      '<input name="amount" value="0"><input name="vaultPassphrase" type="password" value="">',
    );
    restoreRepaintFocus(app, amountFocus);
    const restoredAmount = app.querySelector<HTMLInputElement>('[name="amount"]');
    expect(restoredAmount?.value).toBe("1.250");
    expect(restoredAmount?.selectionStart).toBe(5);

    const passphrase = app.querySelector<HTMLInputElement>('[name="vaultPassphrase"]');
    if (!passphrase) throw new Error("passphrase field missing");
    passphrase.value = "never carry this";
    passphrase.focus();
    const secretFocus = captureRepaintFocus();
    paintApp(
      '<input name="amount" value="0"><input name="vaultPassphrase" type="password" value="">',
    );
    restoreRepaintFocus(app, secretFocus);
    expect(app.querySelector<HTMLInputElement>('[name="vaultPassphrase"]')?.value).toBe("");
  });

  test("keeps a half-typed drawer folder name across a repaint", () => {
    const app = paintApp('<input id="drawer-folder-name" name="folderName" value="">');
    const input = app.querySelector<HTMLInputElement>('[name="folderName"]');
    if (!input) {
      throw new Error("folder name missing");
    }
    input.focus();
    input.value = "Trading";
    input.setSelectionRange(4, 4);
    const focus = captureRepaintFocus();

    paintApp('<input id="drawer-folder-name" name="folderName" value="">');
    restoreRepaintFocus(app, focus);

    const after = app.querySelector<HTMLInputElement>('[name="folderName"]');
    expect(document.activeElement).toBe(after);
    expect(after?.value).toBe("Trading");
    expect(after?.selectionStart).toBe(4);
  });
});
