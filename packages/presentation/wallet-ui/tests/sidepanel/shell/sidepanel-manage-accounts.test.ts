/**
 * Behavioural coverage for the "Accounts & groups" manage view (`accountFlow` /
 * the `account` view), driven through the real bindings under happy-dom.
 * Switching accounts is the drawer's job: this screen lists every account to
 * name it and to file it into a folder, and offers no select control at all —
 * the duplicate switcher it used to carry is gone. The suite also guards the two
 * behaviours that must NOT change: the flow header's back control still defers
 * to the nav-history back-stack (it carries `data-nav-back`, not a static
 * target), and tapping a group's folder header opens its members picker without
 * navigating away.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { AccountGroup } from "@bramble/settings/groups";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { accountFlow } from "../../../src/sidepanel/app/screens/flows";
import type { WalletView } from "../../../src/sidepanel/app/screens/views";
import {
  bindGroupControls,
  type GroupControlDeps,
} from "../../../src/sidepanel/journeys/settings/group-ui";
import { bindPickers, type ShellBindingDeps } from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const workGroup: AccountGroup = { accountIds: [], icon: "folder", id: "work", name: "Work" };

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
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

type Harness = {
  readonly container: HTMLElement;
  readonly viewChanges: WalletView[];
  readonly setActiveAccountCalls: string[];
  readonly tick: () => Promise<void>;
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Mounts the manage view and wires the real pickers + group controls against a
// recording fake wallet. State (active view, expanded group) is held here and
// mirrored back through the binding deps, exactly like the entrypoint.
const mount = (groups: AccountGroup[] = []): Harness => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "app";
  document.body.append(container);

  const prefs: WalletPreferences = { ...preferences, groups };
  const viewChanges: WalletView[] = [];
  const setActiveAccountCalls: string[] = [];
  let expandedGroupId: string | null = null;

  const wallet = {
    loadStatus: (): Promise<WalletStatus> => Promise.resolve(status),
    setActiveAccount: (accountId: string): Promise<void> => {
      setActiveAccountCalls.push(accountId);
      return Promise.resolve();
    },
    setActiveNetwork: (): Promise<WalletStatus> => Promise.resolve(status),
  };

  const paint = (): void => {
    container.replaceChildren(
      document.createRange().createContextualFragment(accountFlow(status, prefs, expandedGroupId)),
    );
    const shellDeps: ShellBindingDeps = {
      app: container,
      render: async () => {
        paint();
      },
      setActiveView: (view: WalletView) => {
        viewChanges.push(view);
      },
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    };
    const groupDeps: GroupControlDeps = {
      expandedGroup: () => expandedGroupId,
      rerender: async () => {
        paint();
      },
      setExpandedGroup: (id) => {
        expandedGroupId = id;
      },
      wallet: wallet as unknown as GroupControlDeps["wallet"],
    };
    bindPickers(shellDeps);
    bindGroupControls(container, groupDeps);
  };

  paint();
  return { container, setActiveAccountCalls, tick, viewChanges };
};

const click = (element: Element | null): void => {
  if (!(element instanceof window.HTMLElement)) {
    throw new Error("click target missing");
  }
  element.click();
};

describe("Accounts & groups manage view", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("offers no account switcher: every account is here to be named, not selected", () => {
    const harness = mount();

    // The old picker rows are gone, so the drawer is the one place an account is
    // switched and this screen can never race it.
    expect(harness.container.querySelectorAll("[data-account-id]").length).toBe(0);
    expect(harness.container.querySelector('[aria-label="Accounts"]')).toBeNull();
    // Each account is present as an editable name instead.
    for (const stored of [account, secondAccount]) {
      expect(
        harness.container.querySelector(`[data-account-name-form="${stored.id}"]`),
      ).not.toBeNull();
    }
    expect(harness.setActiveAccountCalls).toEqual([]);
    expect(harness.viewChanges).toEqual([]);
  });

  test("the back control still defers to the nav-history back-stack (unchanged)", () => {
    const harness = mount();

    const back = harness.container.querySelector('.flow-header [aria-label="Back"]');
    // The back arrow carries no static target: it pops the nav history so Back
    // returns to the entry point, exactly as before this change.
    expect(back).not.toBeNull();
    expect(back?.hasAttribute("data-nav-back")).toBe(true);
    expect(back?.hasAttribute("data-view")).toBe(false);
  });

  test("tapping a group's folder header opens its members picker without navigating", async () => {
    const harness = mount([workGroup]);

    const editor = harness.container.querySelector(`#group-editor-${workGroup.id}`);
    expect(editor?.hasAttribute("hidden")).toBe(true);

    click(harness.container.querySelector(`[data-group-expand="${workGroup.id}"]`));
    await harness.tick();

    // The members picker opens...
    expect(
      harness.container.querySelector(`#group-editor-${workGroup.id}`)?.hasAttribute("hidden"),
    ).toBe(false);
    expect(
      harness.container.querySelectorAll(`[data-group-toggle="${workGroup.id}"]`).length,
    ).toBeGreaterThan(0);
    // ...and no navigation happens: the group control never routes to Home.
    expect(harness.viewChanges).toEqual([]);
  });
});
