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

import { WalletError } from "@bramble/core/errors";
import {
  type AccountGroup,
  type AccountGroupIcon,
  type AccountGroups,
  createGroup,
  isDefaultGroup,
  removeGroup,
  renameGroup,
  setAccountInGroup,
  setGroupIcon,
  withDefaultGroups,
} from "@bramble/settings/groups";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../src/popup/responses/responses";
import {
  captureRepaintFocus,
  restoreRepaintFocus,
} from "../../src/sidepanel/app/rendering/focus-memo";
import { accountFlow } from "../../src/sidepanel/app/screens/flows";
import type { HomeUiDeps } from "../../src/sidepanel/journeys/portfolio/home-ui";
import { bindHomeUi } from "../../src/sidepanel/journeys/portfolio/home-ui";
import { healTransientGroupState } from "../../src/sidepanel/journeys/settings/group-state";
import type { GroupControlDeps } from "../../src/sidepanel/journeys/settings/group-ui";
import { bindGroupControls } from "../../src/sidepanel/journeys/settings/group-ui";
import { accountDrawer } from "../../src/sidepanel/shell/account-drawer";
import {
  bindDrawerFolders,
  createDrawerFolderState,
} from "../../src/sidepanel/shell/drawer-folders-ui";

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
const newAccountId = "SN_MAIN:0x9c";

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
type Calls = {
  createGroup: Array<readonly [string, AccountGroupIcon]>;
  renameGroup: Array<readonly [string, string]>;
  setGroupIcon: Array<readonly [string, AccountGroupIcon]>;
  removeGroup: string[];
  setAccountInGroup: Array<readonly [string, string, boolean]>;
  addAccount: string[];
  startAddAccount: number;
};

export type Harness = {
  readonly container: HTMLElement;
  readonly calls: Calls;
  readonly groups: () => AccountGroups;
  /**
   * One stored group by id. Positional lookup is not usable: the seeded default
   * folders bracket the user's own, so index 0 is "My accounts", not the first
   * fixture group.
   */
  readonly groupById: (id: string) => AccountGroup | undefined;
  /** Repaints the mounted view the way a balance update does, keeping focus. */
  readonly repaint: () => void;
  readonly tick: () => Promise<void>;
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const buildWallet = (
  readGroups: () => AccountGroups,
  setGroups: (next: AccountGroups) => void,
  calls: Calls,
  rejects: boolean,
) => {
  // Mirrors the real store: every group write starts from a seeded list, so a
  // test can file an account into a default folder the fixture never declared.
  const getGroups = (): AccountGroups => withDefaultGroups(readGroups());
  // A store fault, so the failure paths (error toast, un-busied control, the
  // unchanged store) are driven by the real bindings rather than assumed.
  const fail = <T>(): Promise<T> => Promise.reject(new WalletError("store unavailable"));
  return {
    createGroup: (name: string, groupIcon: AccountGroupIcon): Promise<string> => {
      calls.createGroup.push([name, groupIcon]);
      if (rejects) {
        return fail();
      }
      const next = withDefaultGroups(createGroup(getGroups(), name, groupIcon));
      setGroups(next);
      const created = [...next].reverse().find((entry) => !isDefaultGroup(entry.id));
      return Promise.resolve(created?.id ?? "");
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
      if (rejects) {
        return fail();
      }
      setGroups(setAccountInGroup(getGroups(), groupId, accountId, member));
      return Promise.resolve();
    },
    addAccount: (networkId: string): Promise<string> => {
      calls.addAccount.push(networkId);
      return Promise.resolve(newAccountId);
    },
    setActiveAccount: (): Promise<void> => Promise.resolve(),
    loadStatus: (): Promise<WalletStatus> => Promise.resolve(status),
  };
};

// Shared transient UI state, mirroring the entrypoint module vars.
type UiState = {
  expandedGroupId: string | null;
};

// Replaces the container's children from markup without innerHTML, so each paint
// yields fresh nodes exactly like the real shell swap.
const paint = (container: HTMLElement, html: string): void => {
  container.replaceChildren(document.createRange().createContextualFragment(html));
};

/** Options for {@link mount}; `rejects` makes every group write fail. */
export type MountOptions = {
  readonly rejects?: boolean;
};

export const mount = (
  initialGroups: AccountGroups,
  view: "drawer" | "account",
  options: MountOptions = {},
): Harness => {
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
    startAddAccount: 0,
  };
  const folders = createDrawerFolderState();
  const state: UiState = {
    expandedGroupId: null,
  };
  const wallet = buildWallet(
    () => groups,
    (next) => {
      groups = next;
    },
    calls,
    options.rejects === true,
  ) as unknown as GroupControlDeps["wallet"];
  const prefs = (): WalletPreferences => ({ ...preferences, groups });

  const groupDeps: GroupControlDeps = {
    expandedGroup: () => state.expandedGroupId,
    rerender: async () => {
      render();
    },
    setExpandedGroup: (id) => {
      state.expandedGroupId = id;
    },
    wallet,
  };

  const homeDeps: HomeUiDeps = {
    app: container,
    drawerOpen: () => true,
    networkId: () => "SN_MAIN",
    render: async () => {
      render();
    },
    setDrawerOpen: () => undefined,
    startAddAccount: () => {
      calls.startAddAccount += 1;
    },
    wallet: wallet as unknown as HomeUiDeps["wallet"],
  };

  const render = (): void => {
    // Mirror the entrypoint's paint(): heal the stale expanded group against the
    // current store before rendering, so a deleted group's editor can never
    // silently re-apply and tests exercise the real self-heal path.
    state.expandedGroupId = healTransientGroupState(
      { expandedGroupId: state.expandedGroupId },
      withDefaultGroups(groups),
    ).expandedGroupId;
    if (view === "drawer") {
      const focus = captureRepaintFocus(container);
      const trigger = '<button id="account-trigger" aria-haspopup="dialog"></button>';
      paint(
        container,
        trigger +
          accountDrawer(
            status,
            acctA,
            prefs(),
            folders.collapsedFolders(),
            folders.addFolderOpen(),
          ),
      );
      restoreRepaintFocus(container, focus);
      bindGroupControls(container, groupDeps);
      bindHomeUi(homeDeps);
      bindDrawerFolders({
        ...folders,
        app: container,
        render: async () => {
          render();
        },
        wallet,
      });
    } else {
      paint(container, accountFlow(status, acctA, prefs(), state.expandedGroupId));
      bindGroupControls(container, groupDeps);
    }
  };

  render();
  return {
    calls,
    container,
    groupById: (id) => groups.find((group) => group.id === id),
    groups: () => groups,
    repaint: () => {
      render();
    },
    tick,
  };
};

export const click = (element: Element | null): void => {
  if (!(element instanceof window.HTMLElement)) {
    throw new Error("click target missing");
  }
  element.click();
};

// happy-dom constructs a DragEvent but drops `dataTransfer` from the init dict,
// leaving it undefined, so the one clipboard the drag carries is attached here.
// Everything else — setData on dragstart, getData on drop — is the real
// DataTransfer the bindings call, not a stub standing in for them.
const dragEvent = (type: string, dataTransfer: DataTransfer): DragEvent => {
  const event = new window.DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
};

/**
 * Drives the dragstart → dragover → drop sequence that moves `accountId` onto
 * the folder section `groupId`, exactly as a pointer drag produces it. Pass an
 * `emptyDrop` of true to model a browser that hands the drop an empty payload,
 * which is what the binding's dragging-row fallback exists for.
 */
export const dragAccountToFolder = (
  container: HTMLElement,
  accountId: string,
  groupId: string,
  emptyDrop = false,
): void => {
  const row = container.querySelector<HTMLElement>(
    `[data-drag-account="${CSS.escape(accountId)}"]`,
  );
  const folder = container.querySelector<HTMLElement>(`[data-folder="${CSS.escape(groupId)}"]`);
  if (!row || !folder) {
    throw new Error("drag source or drop target missing");
  }
  const dataTransfer = new window.DataTransfer();
  row.dispatchEvent(dragEvent("dragstart", dataTransfer));
  folder.dispatchEvent(dragEvent("dragover", dataTransfer));
  folder.dispatchEvent(dragEvent("drop", emptyDrop ? new window.DataTransfer() : dataTransfer));
  row.dispatchEvent(dragEvent("dragend", dataTransfer));
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
