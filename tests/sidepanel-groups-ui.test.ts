/**
 * UI-interaction coverage for the account-groups ("folders") binding chain that
 * had no tests: it renders the real drawer and manage-accounts templates into a
 * happy-dom document, wires the real `bindGroupControls`/`bindHomeUi`, and drives
 * clicks and form submits. A fake wallet records calls and applies the real pure
 * model to an in-memory groups list, and a re-render harness mirrors the paint
 * loop — so each test asserts BOTH that the correct store method is called AND
 * that the UI re-derives from the mutated store. Covers create from the drawer,
 * rename, change icon, delete (with confirm), assign, assign to a second group
 * without the panel collapsing, filter, and the empty state.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { accountDrawer } from "../src/sidepanel/account-drawer";
import { accountFlow } from "../src/sidepanel/flows";
import type { GroupControlDeps } from "../src/sidepanel/group-ui";
import { bindGroupControls } from "../src/sidepanel/group-ui";
import type { HomeUiDeps } from "../src/sidepanel/home-ui";
import { bindHomeUi } from "../src/sidepanel/home-ui";
import { icon } from "../src/sidepanel/icons";
import {
  type AccountGroupIcon,
  type AccountGroups,
  createGroup,
  removeGroup,
  renameGroup,
  setAccountInGroup,
  setGroupIcon,
} from "../src/storage/account-groups";
import type { WalletPreferences } from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";
import { account, preferences } from "./support/sidepanel-fixtures";

// Minimal WAAPI + matchMedia so the toast/motion helpers run under happy-dom
// (which ships neither): reduced motion routes through a no-op cut-to-final.
const installMotionStubs = (): void => {
  const media = (query: string): MediaQueryList =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  window.matchMedia = media as unknown as typeof window.matchMedia;
  const proto = window.HTMLElement.prototype as unknown as {
    animate: () => Animation;
    getAnimations: () => Animation[];
  };
  proto.animate = () =>
    ({
      cancel: () => undefined,
      finished: Promise.resolve(),
      onfinish: null,
    }) as unknown as Animation;
  proto.getAnimations = () => [];
};

// The happy-dom global registrator, loaded lazily so the DOM only exists while
// this suite runs (other suites keep their non-DOM environment).
type Registrator = {
  isRegistered: boolean;
  register: () => void;
  unregister: () => Promise<void>;
};
let registrator: Registrator | null = null;

beforeAll(async () => {
  // A non-literal specifier keeps happy-dom's shipped .d.ts out of the strict
  // `skipLibCheck: false` typecheck while the runtime still gets a real DOM.
  const specifier = "@happy-dom/global-registrator";
  const loaded = (await import(specifier)) as { GlobalRegistrator: Registrator };
  registrator = loaded.GlobalRegistrator;
  if (!registrator.isRegistered) {
    registrator.register();
  }
  installMotionStubs();
});

afterAll(async () => {
  if (registrator?.isRegistered) {
    await registrator.unregister();
  }
});

// Fixture accounts with real (small, non-zero felt) ids so the pure model's
// `isAccountId` guard accepts membership toggles, mirroring wallet/account ids.
const acctA: AccountRef = { ...account, address: "0x2a", id: "SN_MAIN:0x2a" };
const acctB: AccountRef = { ...account, address: "0x3b", id: "SN_MAIN:0x3b" };

const status: WalletStatus = {
  accountCount: 2,
  accounts: [acctA, acctB],
  activeAccountId: acctA.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
};

// A recording fake wallet that applies the real pure model to an in-memory
// groups list, so a mutation persists as the background store would and the next
// render re-derives from it. Only the methods the bindings call are implemented.
type Calls = {
  createGroup: Array<readonly [string, AccountGroupIcon]>;
  renameGroup: Array<readonly [string, string]>;
  setGroupIcon: Array<readonly [string, AccountGroupIcon]>;
  removeGroup: string[];
  setAccountInGroup: Array<readonly [string, string, boolean]>;
};

type Harness = {
  readonly container: HTMLElement;
  readonly calls: Calls;
  readonly groups: () => AccountGroups;
  readonly tick: () => Promise<void>;
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const buildWallet = (
  getGroups: () => AccountGroups,
  setGroups: (next: AccountGroups) => void,
  calls: Calls,
) => ({
  createGroup: (name: string, groupIcon: AccountGroupIcon): Promise<string> => {
    calls.createGroup.push([name, groupIcon]);
    const next = createGroup(getGroups(), name, groupIcon);
    setGroups(next);
    return Promise.resolve(next[next.length - 1]?.id ?? "");
  },
  renameGroup: (id: string, name: string): Promise<void> => {
    calls.renameGroup.push([id, name]);
    setGroups(renameGroup(getGroups(), id, name));
    return Promise.resolve();
  },
  setGroupIcon: (id: string, groupIcon: AccountGroupIcon): Promise<void> => {
    calls.setGroupIcon.push([id, groupIcon]);
    setGroups(setGroupIcon(getGroups(), id, groupIcon));
    return Promise.resolve();
  },
  removeGroup: (id: string): Promise<void> => {
    calls.removeGroup.push(id);
    setGroups(removeGroup(getGroups(), id));
    return Promise.resolve();
  },
  setAccountInGroup: (accountId: string, groupId: string, member: boolean): Promise<void> => {
    calls.setAccountInGroup.push([accountId, groupId, member]);
    setGroups(setAccountInGroup(getGroups(), groupId, accountId, member));
    return Promise.resolve();
  },
  addAccount: (): Promise<void> => Promise.resolve(),
  setActiveAccount: (): Promise<void> => Promise.resolve(),
  loadStatus: (): Promise<WalletStatus> => Promise.resolve(status),
});

// Shared transient UI state, mirroring the entrypoint module vars.
type UiState = {
  filter: string | null;
  openAssign: string | null;
  expandedGroupId: string | null;
  createOpen: boolean;
};

const mount = (initialGroups: AccountGroups, view: "drawer" | "account"): Harness => {
  document.body.innerHTML = '<div id="app"></div>';
  const container = document.querySelector<HTMLElement>("#app");
  if (!container) {
    throw new Error("container missing");
  }
  let groups: AccountGroups = initialGroups;
  const calls: Calls = {
    createGroup: [],
    renameGroup: [],
    setGroupIcon: [],
    removeGroup: [],
    setAccountInGroup: [],
  };
  const state: UiState = {
    createOpen: false,
    expandedGroupId: null,
    filter: null,
    openAssign: null,
  };
  const wallet = buildWallet(
    () => groups,
    (next) => {
      groups = next;
    },
    calls,
  ) as unknown as GroupControlDeps["wallet"];
  const prefs = (): WalletPreferences => ({ ...preferences, groups });

  const groupDeps: GroupControlDeps = {
    expandedGroup: () => state.expandedGroupId,
    openAssign: () => state.openAssign,
    rerender: async () => {
      render();
    },
    setExpandedGroup: (id) => {
      state.expandedGroupId = id;
      state.createOpen = false;
    },
    setOpenAssign: (id) => {
      state.openAssign = id;
    },
    wallet,
  };

  const homeDeps: HomeUiDeps = {
    app: container,
    drawerCreateOpen: () => state.createOpen,
    drawerGroupFilter: () => state.filter,
    drawerOpen: () => true,
    homeTab: () => "tokens",
    networkId: () => "SN_MAIN",
    render: async () => {
      render();
    },
    setDrawerCreateOpen: (open) => {
      state.createOpen = open;
    },
    setDrawerGroupFilter: (filter) => {
      state.filter = filter;
    },
    setDrawerOpen: () => undefined,
    setHomeTab: () => undefined,
    wallet: wallet as unknown as HomeUiDeps["wallet"],
  };

  const render = (): void => {
    if (view === "drawer") {
      container.innerHTML = `<button id="account-trigger" aria-haspopup="dialog"></button>${accountDrawer(
        status,
        acctA,
        prefs(),
        state.filter,
        state.openAssign,
        state.createOpen,
      )}`;
      bindGroupControls(container, groupDeps);
      bindHomeUi(homeDeps);
    } else {
      container.innerHTML = accountFlow(status, acctA, prefs(), state.expandedGroupId);
      bindGroupControls(container, groupDeps);
    }
  };

  render();
  return { calls, container, groups: () => groups, tick };
};

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

const group = (glyph: AccountGroupIcon, id: string, name: string, accountIds: string[] = []) => ({
  accountIds,
  icon: glyph,
  id,
  name,
});

describe("account drawer group interactions", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("creates a group from the drawer's single top-level New group entry", async () => {
    const harness = mount([], "drawer");

    // The create form is discoverable at the foot even with zero groups, and is
    // NOT duplicated per account row.
    expect(harness.container.querySelectorAll(".new-group-form").length).toBe(1);
    expect(harness.container.querySelector("#drawer-new-group-form")?.hasAttribute("hidden")).toBe(
      true,
    );

    click(harness.container.querySelector("#drawer-new-group"));
    await harness.tick();
    expect(harness.container.querySelector("#drawer-new-group-form")?.hasAttribute("hidden")).toBe(
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
    // UI re-derives: the new group surfaces as a filter chip and the create
    // disclosure settles closed.
    expect(harness.container.querySelector('[data-group-filter="trading"]')).not.toBeNull();
    expect(harness.container.querySelector("#drawer-new-group-form")?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  test("assigns an account to a group and reflects membership on the row", async () => {
    const harness = mount([group("briefcase", "work", "Work")], "drawer");

    click(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`));
    await harness.tick();
    const panel = harness.container.querySelector(`[data-group-assign="${acctA.id}"]`);
    expect(panel?.hasAttribute("hidden")).toBe(false);

    click(
      harness.container.querySelector(`[data-group-toggle="work"][data-account="${acctA.id}"]`),
    );
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([[acctA.id, "work", true]]);
    // Store now has the account in the group; the toggle re-derives pressed, and
    // the account row shows the group's icon.
    expect(harness.groups()[0]?.accountIds).toContain(acctA.id);
    const toggle = harness.container.querySelector(
      `[data-group-toggle="work"][data-account="${acctA.id}"]`,
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    const row = harness.container
      .querySelector(`[data-switch-account="${acctA.id}"]`)
      ?.closest(".drawer-account-item");
    expect(row?.querySelector(".account-groups-line")).not.toBeNull();
  });

  test("assigns to a second group without the panel collapsing", async () => {
    const harness = mount(
      [group("briefcase", "work", "Work"), group("piggyBank", "savings", "Savings")],
      "drawer",
    );

    click(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`));
    await harness.tick();

    click(
      harness.container.querySelector(`[data-group-toggle="work"][data-account="${acctA.id}"]`),
    );
    await harness.tick();
    // Panel stays open after the first toggle so a second group can be added in
    // the same pass.
    expect(
      harness.container.querySelector(`[data-group-assign="${acctA.id}"]`)?.hasAttribute("hidden"),
    ).toBe(false);

    click(
      harness.container.querySelector(`[data-group-toggle="savings"][data-account="${acctA.id}"]`),
    );
    await harness.tick();

    expect(harness.calls.setAccountInGroup).toEqual([
      [acctA.id, "work", true],
      [acctA.id, "savings", true],
    ]);
    expect(harness.groups()[0]?.accountIds).toContain(acctA.id);
    expect(harness.groups()[1]?.accountIds).toContain(acctA.id);
    expect(
      harness.container.querySelector(`[data-group-assign="${acctA.id}"]`)?.hasAttribute("hidden"),
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

  test("shows an empty state with no chips and a create entry when there are no groups", () => {
    const harness = mount([], "drawer");

    expect(harness.container.querySelector(".group-chips")).toBeNull();
    expect(harness.container.querySelector("#drawer-new-group")).not.toBeNull();

    click(harness.container.querySelector(`[data-assign-toggle="${acctA.id}"]`));
    const panel = harness.container.querySelector(`[data-group-assign="${acctA.id}"]`);
    expect(panel?.textContent).toContain("No groups yet");
  });
});

describe("manage-accounts group management", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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
    starProbe.innerHTML = icon("star");
    const folderProbe = document.createElement("span");
    folderProbe.innerHTML = icon("folder");
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
