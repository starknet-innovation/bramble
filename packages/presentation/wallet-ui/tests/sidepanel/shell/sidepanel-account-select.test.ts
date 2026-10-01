/**
 * Behavioural coverage for account selection in the "Accounts & groups" manage
 * view (`accountFlow` / the `account` view), driven through the real
 * `bindPickers` binding under happy-dom. Selecting an account row means "use
 * this account", so after the active account switches the view must land on Home
 * (matching the drawer's account tap) rather than returning to the entry point.
 * The suite also guards the two behaviours that must NOT change: the flow
 * header's back control still defers to the nav-history back-stack (it carries
 * `data-nav-back`, not a static target), and tapping a group's folder header
 * opens its members picker without navigating away.
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
      document
        .createRange()
        .createContextualFragment(accountFlow(status, account, prefs, expandedGroupId)),
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

describe("Accounts & groups account selection", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("selecting an account switches it and lands on Home, not Settings", async () => {
    const harness = mount();

    click(harness.container.querySelector(`[data-account-id="${secondAccount.id}"]`));
    await harness.tick();

    // The tapped account becomes active...
    expect(harness.setActiveAccountCalls).toEqual([secondAccount.id]);
    // ...and the view routes to Home (the now-active account), never back to the
    // Settings entry point.
    expect(harness.viewChanges).toContain("home");
    expect(harness.viewChanges).not.toContain("settings");
    expect(harness.viewChanges.at(-1)).toBe("home");
  });

  test("tapping the already-active account is a no-op (no switch, no navigation)", async () => {
    const harness = mount();

    click(harness.container.querySelector(`[data-account-id="${account.id}"]`));
    await harness.tick();

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
