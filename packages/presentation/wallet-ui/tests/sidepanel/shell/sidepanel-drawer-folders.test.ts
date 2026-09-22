/**
 * The account drawer's folder behaviour, driven through the real template and
 * bindings on the shared happy-dom harness so every assertion checks BOTH the
 * store call and the re-derived DOM: dragging an account from one folder to
 * another, a drop onto its own folder staying a no-op, collapsing and expanding
 * a folder, the archive starting collapsed and sorting last, and creating a
 * folder inline under the last one. Folder renaming, re-iconing and deletion
 * live on the manage view and are covered by
 * ../journeys/settings/sidepanel-groups-ui.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_GROUP_IDS } from "@bramble/settings/groups";
import {
  bindDrawerFolders,
  createDrawerFolderState,
} from "../../../src/sidepanel/shell/drawer-folders-ui";
import { SIDEPANEL_STYLES } from "../../../src/sidepanel/styles/index";
import {
  acctA,
  acctB,
  click,
  dragAccountToFolder,
  group,
  mount,
  registerDom,
  submit,
  unregisterDom,
} from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// The folder a row is rendered under, read back from the re-derived DOM.
const folderOf = (container: HTMLElement, accountId: string): string | null =>
  container
    .querySelector(`[data-drag-account="${accountId}"]`)
    ?.closest("[data-folder]")
    ?.getAttribute("data-folder") ?? null;

describe("account drawer folders", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("the archive sorts last and starts collapsed, with My accounts first", () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    const folders = [...harness.container.querySelectorAll("[data-folder]")].map((section) =>
      section.getAttribute("data-folder"),
    );
    expect(folders).toEqual([DEFAULT_GROUP_IDS.home, "work", DEFAULT_GROUP_IDS.archived]);

    // The drawer's default paints the archive closed — it is where accounts go
    // to be out of the way — and every other folder open.
    const archived = harness.container.querySelector(
      `[data-folder="${DEFAULT_GROUP_IDS.archived}"]`,
    );
    expect(archived?.getAttribute("data-collapsed")).toBe("true");
    expect(archived?.querySelector(".drawer-list")?.hasAttribute("hidden")).toBe(true);
    expect(
      harness.container.querySelector('[data-folder="work"]')?.getAttribute("data-collapsed"),
    ).toBe("false");
  });

  test("dragging an account onto another folder files it there exclusively", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");
    expect(folderOf(harness.container, acctA.id)).toBe("work");

    dragAccountToFolder(harness.container, acctA.id, DEFAULT_GROUP_IDS.archived);
    await harness.tick();

    // Single membership: the exclusive setter files it into the archive, and the
    // re-derived drawer lists it there (expanded, since it now has a row).
    expect(harness.calls.setAccountInGroup).toEqual([[acctA.id, DEFAULT_GROUP_IDS.archived, true]]);
    expect(harness.groupById("work")?.accountIds).not.toContain(acctA.id);
    expect(harness.groupById(DEFAULT_GROUP_IDS.archived)?.accountIds).toContain(acctA.id);
  });

  test("dropping an account onto the folder it is already in writes nothing", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");

    dragAccountToFolder(harness.container, acctA.id, "work");
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([]);
    expect(folderOf(harness.container, acctA.id)).toBe("work");
  });

  test("an unfiled account drags out of My accounts into a real folder", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");
    // acctB is in no folder, so it renders under the home folder without a write.
    expect(folderOf(harness.container, acctB.id)).toBe(DEFAULT_GROUP_IDS.home);
    expect(harness.groupById("work")?.accountIds).toEqual([]);

    dragAccountToFolder(harness.container, acctB.id, "work");
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([[acctB.id, "work", true]]);
    expect(folderOf(harness.container, acctB.id)).toBe("work");
  });

  test("a drop whose payload is empty still moves the row being dragged", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");

    // Some browsers hand the drop an empty DataTransfer; the source row is still
    // marked as dragging (dragend fires after drop), so the move survives.
    dragAccountToFolder(harness.container, acctA.id, DEFAULT_GROUP_IDS.archived, true);
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([[acctA.id, DEFAULT_GROUP_IDS.archived, true]]);
  });

  test("the folder heading toggles its list closed and open again", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer");
    const head = () => harness.container.querySelector('[data-folder-toggle="work"]');

    click(head());
    await harness.tick();
    expect(
      harness.container.querySelector('[data-folder="work"]')?.getAttribute("data-collapsed"),
    ).toBe("true");
    expect(head()?.getAttribute("aria-expanded")).toBe("false");

    click(head());
    await harness.tick();
    expect(
      harness.container.querySelector('[data-folder="work"]')?.getAttribute("data-collapsed"),
    ).toBe("false");
    expect(head()?.getAttribute("aria-expanded")).toBe("true");
  });

  test("Add folder creates a folder inline, below the last one", async () => {
    const harness = mount([], "drawer");

    click(harness.container.querySelector("#drawer-add-folder"));
    await harness.tick();
    const form = harness.container.querySelector("#drawer-folder-form");
    expect(form).not.toBeNull();

    const name = harness.container.querySelector<HTMLInputElement>("#drawer-folder-name");
    if (name) {
      name.value = "Trading";
    }
    submit(form);
    await harness.tick();

    // Every folder made here takes the plain folder glyph; icons are chosen on
    // the manage view.
    expect(harness.calls.createGroup).toEqual([["Trading", "folder"]]);
    // It lands between the home folder and the archive, and the field closes.
    const folders = [...harness.container.querySelectorAll("[data-folder]")].map((section) =>
      section.getAttribute("data-folder"),
    );
    expect(folders).toEqual([DEFAULT_GROUP_IDS.home, "trading", DEFAULT_GROUP_IDS.archived]);
    expect(harness.container.querySelector("#drawer-folder-form")).toBeNull();
    expect(harness.container.querySelector("#drawer-add-folder")).not.toBeNull();
  });

  test("an empty folder name is refused without touching the store", async () => {
    const harness = mount([], "drawer");

    click(harness.container.querySelector("#drawer-add-folder"));
    await harness.tick();
    submit(harness.container.querySelector("#drawer-folder-form"));
    await harness.tick();

    expect(harness.calls.createGroup).toEqual([]);
    expect(harness.container.querySelector("#drawer-folder-result")?.textContent).toContain(
      "Name the folder",
    );
    // The field stays open so the name can be typed without reopening it.
    expect(harness.container.querySelector("#drawer-folder-form")).not.toBeNull();
  });

  test("Cancel closes the inline field without creating anything", async () => {
    const harness = mount([], "drawer");

    click(harness.container.querySelector("#drawer-add-folder"));
    await harness.tick();
    click(harness.container.querySelector("#drawer-folder-cancel"));
    await harness.tick();

    expect(harness.calls.createGroup).toEqual([]);
    expect(harness.container.querySelector("#drawer-folder-form")).toBeNull();
    expect(harness.container.querySelector("#drawer-add-folder")).not.toBeNull();
  });

  test("a failed move leaves the account where it was and says so", async () => {
    const harness = mount([group("briefcase", "work", "Work", [acctA.id])], "drawer", {
      rejects: true,
    });

    dragAccountToFolder(harness.container, acctA.id, DEFAULT_GROUP_IDS.archived);
    await harness.tick();

    expect(document.querySelector(".toast.error")).not.toBeNull();
    expect(folderOf(harness.container, acctA.id)).toBe("work");
  });

  test("a failed create keeps the field open with the reason in place", async () => {
    const harness = mount([], "drawer", { rejects: true });

    click(harness.container.querySelector("#drawer-add-folder"));
    await harness.tick();
    const name = harness.container.querySelector<HTMLInputElement>("#drawer-folder-name");
    if (name) {
      name.value = "Trading";
    }
    submit(harness.container.querySelector("#drawer-folder-form"));
    await harness.tick();

    expect(harness.container.querySelector("#drawer-folder-form")).not.toBeNull();
    expect(harness.container.querySelector("#drawer-folder-result")?.textContent).toContain(
      "store unavailable",
    );
    // The submit is released so the corrected name can be sent again.
    expect(
      harness.container.querySelector<HTMLButtonElement>("#drawer-folder-create")?.disabled,
    ).toBe(false);
  });

  test("Add account opens the shared chooser instead of deriving inside the drawer", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    click(harness.container.querySelector("#drawer-add-account"));
    await harness.tick();

    expect(harness.calls.startAddAccount).toBe(1);
    expect(harness.calls.addAccount).toEqual([]);
    expect(harness.calls.setAccountInGroup).toEqual([]);
  });

  test("rows stay lean switch controls: full address on hover, copy on the manage view", () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");
    const row = harness.container.querySelector(`[data-switch-account="${acctA.id}"]`);

    expect(row?.querySelector("code")?.getAttribute("title")).toBe(acctA.address);
    expect(harness.container.querySelector(".account-drawer [data-copy]")).toBeNull();
    expect(harness.container.querySelector('.account-drawer [data-view="account"]')).not.toBeNull();
  });
});

describe("drawer folder view state", () => {
  test("starts with the archive collapsed and the create field closed", () => {
    const state = createDrawerFolderState();

    expect(state.collapsedFolders()).toEqual([DEFAULT_GROUP_IDS.archived]);
    expect(state.addFolderOpen()).toBe(false);
  });

  test("keeps what was set, so both survive the repaint after a write", () => {
    const state = createDrawerFolderState();

    state.setCollapsedFolders(["work"]);
    state.setAddFolderOpen(true);

    expect(state.collapsedFolders()).toEqual(["work"]);
    expect(state.addFolderOpen()).toBe(true);
  });
});

describe("bindDrawerFolders without a drawer", () => {
  test("binds nothing when the painted screen has no drawer", () => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    app.append(document.createRange().createContextualFragment("<main>No drawer here</main>"));
    document.body.append(app);

    // A flow screen paints no drawer; binding must be a safe no-op rather than
    // throwing on every render that is not a dock screen.
    expect(() =>
      bindDrawerFolders({
        addFolderOpen: () => false,
        app,
        collapsedFolders: () => [],
        render: async () => undefined,
        setAddFolderOpen: () => undefined,
        setCollapsedFolders: () => undefined,
        wallet: {} as never,
      }),
    ).not.toThrow();
  });
});

describe("drawer folder styles", () => {
  test("the folders are the drawer's scroll region, not the whole panel", () => {
    // The head and "Add account" are pinned by the drawer's flex column; the
    // folders scroll between them, so a wallet with many folders still reaches
    // the footer. This lived on .drawer-list while the drawer was one flat list.
    const folders = /\.drawer-folders \{([^}]*)\}/.exec(SIDEPANEL_STYLES)?.[1] ?? "";
    expect(folders).toContain("flex: 1");
    expect(folders).toContain("overflow-y: auto");
    const list = /\.drawer-list \{([^}]*)\}/.exec(SIDEPANEL_STYLES)?.[1] ?? "";
    expect(list).not.toContain("overflow-y");
  });
});
