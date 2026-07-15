/**
 * Shared happy-dom harness for the account-groups ("folders") UI suites. It
 * mounts the real drawer and manage-accounts templates, wires the real
 * `bindGroupControls`/`bindHomeUi`, and drives clicks and form submits. A fake
 * wallet records calls and applies the real pure model to an in-memory groups
 * list; the re-render mirrors the entrypoint paint loop — including
 * `healTransientGroupState` — so each test asserts BOTH that the correct store
 * method is called AND that the UI re-derives from the mutated store. Split out
 * of the suites so the drawer and edge-case files share one source.
 */
import type { WalletStatus } from "../../src/popup/responses";
import { accountDrawer } from "../../src/sidepanel/account-drawer";
import { accountFlow } from "../../src/sidepanel/flows";
import { healTransientGroupState } from "../../src/sidepanel/group-state";
import type { GroupControlDeps } from "../../src/sidepanel/group-ui";
import { bindGroupControls } from "../../src/sidepanel/group-ui";
import type { HomeUiDeps } from "../../src/sidepanel/home-ui";
import { bindHomeUi } from "../../src/sidepanel/home-ui";
import {
  type AccountGroup,
  type AccountGroupIcon,
  type AccountGroups,
  createGroup,
  removeGroup,
  renameGroup,
  setAccountInGroup,
  setGroupIcon,
} from "../../src/storage/account-groups";
import type { WalletPreferences } from "../../src/storage/preferences-store";
import type { AccountRef } from "../../src/storage/vault-schema";
import { account, preferences } from "./sidepanel-fixtures";

// Minimal WAAPI + matchMedia so the toast/motion helpers run under happy-dom
// (which ships neither): reduced motion routes through a no-op cut-to-final.
export const installMotionStubs = (): void => {
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

// The happy-dom global registrator, loaded lazily so the DOM only exists while a
// suite runs (other suites keep their non-DOM environment). Each suite calls
// `registerDom`/`unregisterDom` from its own beforeAll/afterAll.
//
// happy-dom's shipped declarations transitively import `happy-dom`'s own type
// surface, which does not survive this repo's strict `skipLibCheck: false`
// typecheck (an upstream Console/NodeJS typing incompatibility, unrelated to this
// harness). A local ambient `declare module` cannot shadow an installed package's
// types, and weakening `tsconfig`/suppressing the check are hard-rule violations,
// so the broken declarations must stay out of the program: the module is loaded
// at runtime only and validated here against the narrow `Registrator` contract we
// actually use — a checked boundary (parse, don't validate) rather than a blind
// cast to an assumed shape.
type Registrator = {
  readonly isRegistered: boolean;
  readonly register: () => void;
  readonly unregister: () => Promise<void>;
};

const HAPPY_DOM_REGISTRATOR_MODULE = "@happy-dom/global-registrator";

const asRegistrator = (value: unknown): Registrator => {
  // GlobalRegistrator is a class exposing static members, so it is a function
  // rather than a plain object; validate the members we call either way.
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw new Error("@happy-dom/global-registrator export has an unexpected shape");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate["isRegistered"] !== "boolean" ||
    typeof candidate["register"] !== "function" ||
    typeof candidate["unregister"] !== "function"
  ) {
    throw new Error("@happy-dom/global-registrator export has an unexpected shape");
  }
  return value as Registrator;
};

let registrator: Registrator | null = null;

export const registerDom = async (): Promise<void> => {
  const loaded = (await import(HAPPY_DOM_REGISTRATOR_MODULE)) as {
    readonly GlobalRegistrator?: unknown;
  };
  registrator = asRegistrator(loaded.GlobalRegistrator);
  if (!registrator.isRegistered) {
    registrator.register();
  }
  installMotionStubs();
};

export const unregisterDom = async (): Promise<void> => {
  if (registrator?.isRegistered) {
    await registrator.unregister();
  }
};

// Fixture accounts with real (small, non-zero felt) ids so the pure model's
// `isAccountId` guard accepts membership toggles, mirroring wallet/account ids.
export const acctA: AccountRef = { ...account, address: "0x2a", id: "SN_MAIN:0x2a" };
export const acctB: AccountRef = { ...account, address: "0x3b", id: "SN_MAIN:0x3b" };
// Id the fake `addAccount` returns, so the "add account joins the folder" flow
// can assert the follow-up membership call carries the freshly created id.
export const newAccountId = "SN_MAIN:0x9c";

export const status: WalletStatus = {
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
export type Calls = {
  createGroup: Array<readonly [string, AccountGroupIcon]>;
  renameGroup: Array<readonly [string, string]>;
  setGroupIcon: Array<readonly [string, AccountGroupIcon]>;
  removeGroup: string[];
  setAccountInGroup: Array<readonly [string, string, boolean]>;
  addAccount: string[];
};

export type Harness = {
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
  addAccount: (networkId: string): Promise<string> => {
    calls.addAccount.push(networkId);
    return Promise.resolve(newAccountId);
  },
  setActiveAccount: (): Promise<void> => Promise.resolve(),
  loadStatus: (): Promise<WalletStatus> => Promise.resolve(status),
});

// Shared transient UI state, mirroring the entrypoint module vars.
type UiState = {
  filter: string | null;
  openAssign: string | null;
  expandedGroupId: string | null;
};

// Replaces the container's children from markup without innerHTML, so each paint
// yields fresh nodes exactly like the real shell swap.
const paint = (container: HTMLElement, html: string): void => {
  container.replaceChildren(document.createRange().createContextualFragment(html));
};

export const mount = (initialGroups: AccountGroups, view: "drawer" | "account"): Harness => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "app";
  document.body.append(container);
  let groups: AccountGroups = initialGroups;
  const calls: Calls = {
    addAccount: [],
    createGroup: [],
    renameGroup: [],
    setGroupIcon: [],
    removeGroup: [],
    setAccountInGroup: [],
  };
  const state: UiState = {
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
    },
    setOpenAssign: (id) => {
      state.openAssign = id;
    },
    wallet,
  };

  const homeDeps: HomeUiDeps = {
    app: container,
    drawerGroupFilter: () => state.filter,
    drawerOpen: () => true,
    homeTab: () => "tokens",
    networkId: () => "SN_MAIN",
    render: async () => {
      render();
    },
    setDrawerGroupFilter: (filter) => {
      state.filter = filter;
    },
    setDrawerOpen: () => undefined,
    setHomeTab: () => undefined,
    wallet: wallet as unknown as HomeUiDeps["wallet"],
  };

  const render = (): void => {
    // Mirror the entrypoint's paint(): heal stale group selections against the
    // current store before rendering, so a deleted group's filter/editor can
    // never silently re-apply and tests exercise the real self-heal path.
    const healed = healTransientGroupState(
      {
        drawerGroupFilter: state.filter,
        expandedGroupId: state.expandedGroupId,
        openAssignId: state.openAssign,
      },
      groups,
      status.accounts.map((stored) => stored.id),
    );
    state.filter = healed.drawerGroupFilter;
    state.expandedGroupId = healed.expandedGroupId;
    state.openAssign = healed.openAssignId;
    if (view === "drawer") {
      const trigger = '<button id="account-trigger" aria-haspopup="dialog"></button>';
      paint(
        container,
        trigger + accountDrawer(status, acctA, prefs(), state.filter, state.openAssign),
      );
      bindGroupControls(container, groupDeps);
      bindHomeUi(homeDeps);
    } else {
      paint(container, accountFlow(status, acctA, prefs(), state.expandedGroupId));
      bindGroupControls(container, groupDeps);
    }
  };

  render();
  return { calls, container, groups: () => groups, tick };
};

export const click = (element: Element | null): void => {
  if (!(element instanceof window.HTMLElement)) {
    throw new Error("click target missing");
  }
  element.click();
};

export const submit = (form: Element | null): void => {
  if (!(form instanceof window.HTMLFormElement)) {
    throw new Error("form missing");
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

export const group = (
  glyph: AccountGroupIcon,
  id: string,
  name: string,
  accountIds: string[] = [],
): AccountGroup => ({
  accountIds,
  icon: glyph,
  id,
  name,
});
