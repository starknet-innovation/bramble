/**
 * Home bindings behaviour under happy-dom: the account drawer (escape-to-close,
 * account switch success / no-op / failure, add-account success and failure),
 * the direct-manipulation dismiss gesture (reduced-motion and animated
 * release), the two-tab portfolio, and guards that skip binding on non-home
 * markup.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { AccountGroup } from "@bramble/settings/groups";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import { bindHomeUi, type HomeUiDeps } from "../../../../src/sidepanel/journeys/portfolio/home-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const workGroup: AccountGroup = {
  accountIds: [account.id],
  icon: "folder",
  id: "work",
  name: "Work",
};

const prefs: WalletPreferences = { ...preferences, groups: [workGroup] };

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

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type WalletFake = HomeUiDeps["wallet"];
type MountOptions = {
  readonly switchRejects?: boolean;
};

type Handle = {
  readonly app: HTMLElement;
  readonly calls: {
    setActiveAccount: string[];
    addAccount: string[];
    setAccountInGroup: Array<readonly [string, string, boolean]>;
    renders: number;
    startAddAccount: number;
  };
  readonly state: { open: boolean };
  readonly paint: () => void;
};

const mount = (options: MountOptions = {}): Handle => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);

  const state: Handle["state"] = { open: false };
  const calls: Handle["calls"] = {
    addAccount: [],
    renders: 0,
    setAccountInGroup: [],
    setActiveAccount: [],
    startAddAccount: 0,
  };

  const wallet = {
    addAccount: (networkId: string): Promise<string> => {
      calls.addAccount.push(networkId);
      return Promise.resolve(secondAccount.id);
    },
    loadStatus: (): Promise<WalletStatus> => Promise.resolve(status),
    setAccountInGroup: (accountId: string, groupId: string, member: boolean): Promise<void> => {
      calls.setAccountInGroup.push([accountId, groupId, member]);
      return Promise.resolve();
    },
    setActiveAccount: (accountId: string): Promise<void> => {
      calls.setActiveAccount.push(accountId);
      return options.switchRejects ? Promise.reject(new Error("switch failed")) : Promise.resolve();
    },
  } as unknown as WalletFake;

  const paint = (): void => {
    calls.renders += 1;
    const html = dashboard(
      "home",
      status,
      [],
      prefs,
      { balances: [] },
      null,
      [],
      [],
      {},
      [],
      null,
      [],
      null,
      {},
      [],
      [],
      null,
      null,
      [],
    );
    app.replaceChildren(document.createRange().createContextualFragment(html));
    bindHomeUi({
      app,
      drawerOpen: () => state.open,
      networkId: () => "SN_MAIN",
      render: async () => {
        paint();
      },
      setDrawerOpen: (open) => {
        state.open = open;
      },
      startAddAccount: () => {
        calls.startAddAccount += 1;
      },
      wallet,
    });
  };

  paint();
  return { app, calls, paint, state };
};

const el = <T extends HTMLElement>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) {
    throw new Error(`missing element: ${selector}`);
  }
  return found;
};

describe("home drawer bindings", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("the trigger toggles the drawer open, and Escape closes it", () => {
    const h = mount();
    const root = el(h.app, ".drawer-root");
    el<HTMLButtonElement>(h.app, "#account-trigger").click();
    expect(h.state.open).toBe(true);
    expect(root.getAttribute("data-open")).toBe("true");

    root.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(h.state.open).toBe(false);
    expect(root.getAttribute("data-open")).toBe("false");
  });

  test("switching to another account activates it, closes the drawer, and re-renders", async () => {
    const h = mount();
    const before = h.calls.renders;
    el<HTMLButtonElement>(h.app, `[data-switch-account="${secondAccount.id}"]`).click();
    await tick();

    expect(h.calls.setActiveAccount).toEqual([secondAccount.id]);
    expect(h.state.open).toBe(false);
    expect(h.calls.renders).toBeGreaterThan(before);
  });

  test("tapping the already-active account just closes the drawer without switching", () => {
    const h = mount();
    el<HTMLButtonElement>(h.app, "#account-trigger").click();
    expect(h.state.open).toBe(true);

    // The active row carries aria-pressed="true": the handler short-circuits to a
    // close with no setActiveAccount call.
    el<HTMLButtonElement>(h.app, `[data-switch-account="${account.id}"]`).click();
    expect(h.calls.setActiveAccount).toEqual([]);
    expect(h.state.open).toBe(false);
  });

  test("a failed account switch surfaces an error toast and un-busies the row", async () => {
    const h = mount({ switchRejects: true });
    const button = el<HTMLButtonElement>(h.app, `[data-switch-account="${secondAccount.id}"]`);
    button.click();
    await tick();

    expect(h.calls.setActiveAccount).toEqual([secondAccount.id]);
    expect(document.querySelector(".toast.error")).not.toBeNull();
    expect(button.disabled).toBe(false);
  });

  test("add-account closes the drawer and opens the shared account chooser", () => {
    const h = mount();
    h.state.open = true;
    h.paint();

    el<HTMLButtonElement>(h.app, "#drawer-add-account").click();

    expect(h.calls.startAddAccount).toBe(1);
    expect(h.calls.addAccount).toEqual([]);
    expect(h.state.open).toBe(false);
  });
});

describe("home drawer dismiss gesture", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  const pointer = (type: string, clientX: number, timeStamp: number): PointerEvent => {
    const event = new window.PointerEvent(type, { bubbles: true, button: 0, clientX });
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
    Object.defineProperty(event, "pointerId", { value: 1 });
    return event;
  };

  test("a leftward flick under reduced motion closes the drawer immediately", () => {
    // installMotionStubs pins matchMedia to reduce, so settle takes the cut path.
    const h = mount();
    el<HTMLButtonElement>(h.app, "#account-trigger").click();
    expect(h.state.open).toBe(true);

    const drawer = el(h.app, ".account-drawer");
    drawer.dispatchEvent(pointer("pointerdown", 200, 0));
    drawer.dispatchEvent(pointer("pointermove", 180, 16));
    drawer.dispatchEvent(pointer("pointermove", 60, 32));
    drawer.dispatchEvent(pointer("pointerup", 40, 48));

    // A big leftward drag projects past the dismiss threshold, so the drawer closes.
    expect(h.state.open).toBe(false);
  });

  test("pointer events on a closed drawer are ignored by every gesture guard", () => {
    const h = mount();
    // The drawer stays closed: pointerdown bails on !isOpen, and the later move
    // and up bail on the un-armed guards, so nothing is dragged.
    const drawer = el(h.app, ".account-drawer");
    drawer.dispatchEvent(pointer("pointerdown", 200, 0));
    drawer.dispatchEvent(pointer("pointermove", 100, 16));
    drawer.dispatchEvent(pointer("pointerup", 90, 32));
    expect(h.state.open).toBe(false);
  });

  test("a small movement below the drag threshold never starts a drag", () => {
    const h = mount();
    el<HTMLButtonElement>(h.app, "#account-trigger").click();
    const drawer = el(h.app, ".account-drawer");

    drawer.dispatchEvent(pointer("pointerdown", 100, 0));
    // Under the 8px threshold: no drag arms, release is a no-op, drawer stays open.
    drawer.dispatchEvent(pointer("pointermove", 104, 16));
    drawer.dispatchEvent(pointer("pointerup", 104, 32));
    expect(h.state.open).toBe(true);
  });

  test("with motion enabled, the release animates and the transitionend closes it", () => {
    const original = window.matchMedia;
    // Motion enabled: settle takes the animated (transition) path instead of the cut.
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const h = mount();
      el<HTMLButtonElement>(h.app, "#account-trigger").click();
      const drawer = el(h.app, ".account-drawer");

      drawer.dispatchEvent(pointer("pointerdown", 200, 0));
      drawer.dispatchEvent(pointer("pointermove", 150, 16));
      drawer.dispatchEvent(pointer("pointermove", 30, 32));
      drawer.dispatchEvent(pointer("pointerup", 20, 48));

      // A non-transform transitionend is ignored (the drawer stays open)...
      const other = new window.Event("transitionend");
      Object.defineProperty(other, "propertyName", { value: "opacity" });
      drawer.dispatchEvent(other);
      expect(h.state.open).toBe(true);

      // ...while the transform transitionend runs the deferred dismiss.
      const end = new window.Event("transitionend");
      Object.defineProperty(end, "propertyName", { value: "transform" });
      drawer.dispatchEvent(end);
      expect(h.state.open).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("home portfolio section", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("renders a Tokens heading with no tablist while Collectibles is parked", () => {
    const h = mount();
    const section = el(h.app, ".home-tabs");
    expect(el(section, "h2").textContent).toBe("Tokens");
    expect(section.innerHTML).not.toContain('role="tab');
    expect(section.querySelector(".tab-panel")).toBeNull();
  });
});

describe("home bindings guards on non-home markup", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("binding is a no-op when the screen has neither a drawer nor tabs", () => {
    const app = document.createElement("div");
    app.id = "app";
    app.append(document.createRange().createContextualFragment("<div>flow screen</div>"));
    document.body.append(app);

    expect(() =>
      bindHomeUi({
        app,
        drawerOpen: () => false,
        networkId: () => "SN_MAIN",
        render: async () => undefined,
        setDrawerOpen: () => undefined,
        wallet: {} as WalletFake,
      }),
    ).not.toThrow();
  });

  test("the drag binding skips a drawer-root missing its sheet and backdrop", () => {
    const app = document.createElement("div");
    app.id = "app";
    app.append(
      document
        .createRange()
        .createContextualFragment(
          '<button id="account-trigger" aria-expanded="false"></button><div class="drawer-root"></div>',
        ),
    );
    document.body.append(app);

    // bindDrawer finds root + trigger, but bindDrawerDrag finds no .account-drawer
    // and returns early without wiring any gesture listeners.
    expect(() =>
      bindHomeUi({
        app,
        drawerOpen: () => false,
        networkId: () => "SN_MAIN",
        render: async () => undefined,
        setDrawerOpen: () => undefined,
        wallet: {} as WalletFake,
      }),
    ).not.toThrow();
    expect(el(app, ".drawer-root").getAttribute("data-open")).toBe("false");
  });

  test("a switch-account control with no account id is ignored", () => {
    const app = document.createElement("div");
    app.id = "app";
    app.append(
      document
        .createRange()
        .createContextualFragment(
          '<button id="account-trigger" aria-expanded="false"></button>' +
            '<div class="drawer-root">' +
            '<div class="drawer-backdrop"></div>' +
            '<aside class="account-drawer">' +
            '<button data-switch-account="" type="button" aria-pressed="false"></button>' +
            "</aside></div>",
        ),
    );
    document.body.append(app);
    const calls: string[] = [];
    bindHomeUi({
      app,
      drawerOpen: () => false,
      networkId: () => "SN_MAIN",
      render: async () => undefined,
      setDrawerOpen: () => undefined,
      wallet: {
        setActiveAccount: (id: string) => {
          calls.push(id);
          return Promise.resolve();
        },
      } as unknown as WalletFake,
    });

    el<HTMLButtonElement>(app, "[data-switch-account]").click();
    // The empty dataset value short-circuits before any switch is attempted.
    expect(calls).toEqual([]);
  });

  test("home bindings tolerate a minimal portfolio region", () => {
    const app = document.createElement("div");
    app.id = "app";
    app.append(
      document
        .createRange()
        .createContextualFragment('<div class="home-tabs"><h2>Tokens</h2></div>'),
    );
    document.body.append(app);

    // A partial specimen with no drawer or menu binds without throwing.
    expect(() =>
      bindHomeUi({
        app,
        drawerOpen: () => false,
        networkId: () => "SN_MAIN",
        render: async () => undefined,
        setDrawerOpen: () => undefined,
        wallet: {} as WalletFake,
      }),
    ).not.toThrow();
  });
});

afterEach(() => {
  document.body.replaceChildren();
});
