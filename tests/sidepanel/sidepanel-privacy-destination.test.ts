/**
 * Unshield destination: the flow names the account a withdrawal will make
 * public, defaults to the active one, lets any owned account be chosen, and
 * offers a freshly derived account so a withdrawal can link to nothing the user
 * has used before. The choice lives in journey state because deriving an account
 * repaints the panel.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import {
  resolveWithdrawDestination,
  withdrawDestinationAddress,
  withdrawDestinationReceipt,
  withdrawDestinationView,
} from "../../src/sidepanel/privacy-destination";
import { bindWithdrawDestination } from "../../src/sidepanel/privacy-destination-ui";
import type { PrivacyJourneyState } from "../../src/sidepanel/privacy-model";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { account, preferences, secondAccount } from "../support/sidepanel-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const view = (selectedAccountId?: string): string =>
  withdrawDestinationView({
    accounts: status.accounts,
    activeAccountId: status.activeAccountId,
    networkId: status.networkId,
    preferences,
    selectedAccountId,
  });

const mount = (selectedAccountId?: string): HTMLElement => {
  const app = document.createElement("main");
  app.innerHTML = view(selectedAccountId);
  document.body.append(app);
  return app;
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("withdraw destination resolution", () => {
  test("defaults to the active account and marks it as such", () => {
    const destination = resolveWithdrawDestination({
      accounts: status.accounts,
      activeAccountId: account.id,
      networkId: "SN_MAIN",
      selectedAccountId: undefined,
    });

    expect(destination.account?.id).toBe(account.id);
    expect(destination.isActive).toBe(true);
  });

  test("honours a chosen account and stops calling it the active one", () => {
    const destination = resolveWithdrawDestination({
      accounts: status.accounts,
      activeAccountId: account.id,
      networkId: "SN_MAIN",
      selectedAccountId: secondAccount.id,
    });

    expect(destination.account?.id).toBe(secondAccount.id);
    expect(destination.isActive).toBe(false);
  });

  test("falls back to the active account when the choice no longer exists", () => {
    // A network switch or a removed account must not leave the withdrawal
    // pointing at nothing.
    const destination = resolveWithdrawDestination({
      accounts: status.accounts,
      activeAccountId: account.id,
      networkId: "SN_MAIN",
      selectedAccountId: "SN_SEPOLIA:0xdead",
    });

    expect(destination.account?.id).toBe(account.id);
  });

  test("a typed address always wins over the selected account", () => {
    const destination = resolveWithdrawDestination({
      accounts: status.accounts,
      activeAccountId: account.id,
      networkId: "SN_MAIN",
      selectedAccountId: undefined,
    });

    expect(withdrawDestinationAddress("  0xabc  ", destination)).toBe("0xabc");
    expect(withdrawDestinationAddress("   ", destination)).toBe(account.address);
  });

  test("with no account on the network there is no address to fall back to", () => {
    const destination = resolveWithdrawDestination({
      accounts: [],
      activeAccountId: null,
      networkId: "SN_MAIN",
      selectedAccountId: undefined,
    });

    expect(destination.account).toBeNull();
    expect(withdrawDestinationAddress("", destination)).toBeUndefined();
  });
});

describe("withdraw destination view", () => {
  test("shows the active account's identity, a switch pill, and the fresh-account action", () => {
    const html = view();

    expect(html).toContain("Withdraw to");
    expect(html).toContain("This account");
    expect(html).toContain("data-privacy-destination-toggle");
    expect(html).toContain("Switch");
    expect(html).toContain("data-privacy-destination-new");
    expect(html).toContain("Withdraw to a fresh account");
    // Every owned account on the network is offered, the active one marked.
    expect(html).toContain(`data-privacy-destination-pick="${account.id}"`);
    expect(html).toContain(`data-privacy-destination-pick="${secondAccount.id}"`);
    expect(html).toMatch(
      new RegExp(`data-privacy-destination-pick="${account.id}"[^>]*aria-pressed="true"`),
    );
    // The manual address escape hatch survives, and the row stays hidden until
    // the flip puts private on top.
    expect(html).toContain('id="privacy-withdraw-recipient"');
    expect(html).toContain("data-privacy-recipient-row hidden");
  });

  test("a chosen non-active account drops the current-account badge", () => {
    const html = view(secondAccount.id);

    expect(html).not.toContain("This account");
    expect(html).toMatch(
      new RegExp(`data-privacy-destination-pick="${secondAccount.id}"[^>]*aria-pressed="true"`),
    );
  });

  test("the review receipt names an owned destination and shortens a foreign one", () => {
    expect(
      withdrawDestinationReceipt({
        accounts: status.accounts,
        preferences,
        // Canonical spelling differs from the stored one; matching is numeric.
        recipient: account.address.replace("0x0", "0x"),
      }),
    ).toContain("…");
    expect(
      withdrawDestinationReceipt({
        accounts: status.accounts,
        preferences,
        recipient: "0x9999999999999999999999999999999999999999999999999999999999999999",
      }),
    ).toBe("0x9999…9999");
  });
});

describe("withdraw destination bindings", () => {
  const deps = (
    journey: () => PrivacyJourneyState,
    wallet: Partial<SidepanelWallet>,
    app: HTMLElement,
  ) => {
    const journeys: PrivacyJourneyState[] = [];
    let paints = 0;
    bindWithdrawDestination({
      app,
      journey,
      paint: () => {
        paints += 1;
      },
      preferences: () => preferences,
      setJourney: (state) => journeys.push(state),
      status: () => status,
      wallet: wallet as SidepanelWallet,
    });
    return { journeys, paints: () => paints };
  };

  test("the switch pill reveals the account list", () => {
    const app = mount();
    const captured = deps(() => ({ stage: "compose", tokenId: "t" }), {}, app);
    const toggle = app.querySelector<HTMLButtonElement>("[data-privacy-destination-toggle]");
    const options = app.querySelector<HTMLElement>("[data-privacy-destination-options]");

    expect(options?.hasAttribute("hidden")).toBe(true);
    toggle?.click();
    expect(options?.hasAttribute("hidden")).toBe(false);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    toggle?.click();
    expect(options?.hasAttribute("hidden")).toBe(true);
    expect(captured.journeys).toEqual([]);
  });

  test("picking an account records it on the compose journey", () => {
    const app = mount();
    const captured = deps(() => ({ stage: "compose", tokenId: "t" }), {}, app);

    app
      .querySelector<HTMLButtonElement>(`[data-privacy-destination-pick="${secondAccount.id}"]`)
      ?.click();

    expect(captured.journeys).toEqual([
      { destinationAccountId: secondAccount.id, stage: "compose", tokenId: "t" },
    ]);
    expect(captured.paints()).toBe(1);
  });

  test("a fresh account is derived and selected in one action", async () => {
    const app = mount();
    const added: string[] = [];
    const captured = deps(
      () => ({ stage: "compose", tokenId: "t" }),
      {
        addAccount: async (networkId: string) => {
          added.push(networkId);
          return "SN_MAIN:0xfresh";
        },
      },
      app,
    );

    app.querySelector<HTMLButtonElement>("[data-privacy-destination-new]")?.click();
    await tick();

    expect(added).toEqual(["SN_MAIN"]);
    // Selected immediately, so the repaint that follows the status refresh shows
    // the new account as the destination rather than reverting to the active one.
    expect(captured.journeys).toEqual([
      { destinationAccountId: "SN_MAIN:0xfresh", stage: "compose", tokenId: "t" },
    ]);
  });

  test("a click landing after the stage advanced cannot resurrect compose", () => {
    const app = mount();
    const captured = deps(() => ({ stage: "idle" }), {}, app);

    app
      .querySelector<HTMLButtonElement>(`[data-privacy-destination-pick="${secondAccount.id}"]`)
      ?.click();

    expect(captured.journeys).toEqual([]);
  });
});
