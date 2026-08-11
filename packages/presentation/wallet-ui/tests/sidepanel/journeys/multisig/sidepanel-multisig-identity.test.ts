/**
 * First-class multisig portfolio identity: the shared account owns the shell
 * avatar/dropdown selection while its signer remains a distinct vault account.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MultisigRecord } from "@mc-wallet/multisig/repository";
import { preferences } from "@mc-wallet/testkit/sidepanel";
import { bindHomeUi } from "../../../../src/sidepanel/journeys/portfolio/home-ui";
import { accountDrawer } from "../../../../src/sidepanel/shell/account-drawer";
import { walletHeader } from "../../../../src/sidepanel/shell/wallet-shell";
import { registerDom, status, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const activeAccount = status.accounts[0];
if (!activeAccount) {
  throw new Error("missing active-account fixture");
}

const treasury: MultisigRecord = {
  address: "0x333",
  id: "SN_MAIN:0x333",
  name: "Treasury",
  networkId: "SN_MAIN",
  quorum: 2,
  signers: [activeAccount.address, status.accounts[1]?.address ?? "0x444"],
};

const operations: MultisigRecord = {
  ...treasury,
  address: "0x555",
  id: "SN_MAIN:0x555",
  name: "Operations",
};

const mount = (selected: MultisigRecord) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.innerHTML = `${walletHeader(status, activeAccount, preferences, selected)}${accountDrawer(
    status,
    activeAccount,
    preferences,
    null,
    null,
    [treasury, operations],
    [],
    selected.id,
  )}`;
  document.body.append(app);
  let selectedSingle = 0;
  let selectedMultisig: string | null = null;
  let open = true;
  const switched: string[] = [];
  bindHomeUi({
    app,
    drawerGroupFilter: () => null,
    drawerOpen: () => open,
    homeTab: () => "tokens",
    networkId: () => "SN_MAIN",
    render: async () => undefined,
    selectPortfolio: (id) => {
      if (id) {
        selectedMultisig = id;
      } else {
        selectedSingle += 1;
      }
    },
    setDrawerGroupFilter: () => undefined,
    setDrawerOpen: (next) => {
      open = next;
    },
    setHomeTab: () => undefined,
    wallet: {
      loadStatus: async () => status,
      setActiveAccount: async (id: string) => {
        switched.push(id);
      },
    } as never,
  });
  return {
    app,
    selectedMultisig: () => selectedMultisig,
    selectedSingle: () => selectedSingle,
    switched,
  };
};

describe("multisig account identity", () => {
  test("the shell uses the multisig avatar, name, threshold, and account selector", () => {
    const { app } = mount(treasury);
    expect(app.querySelector("#account-trigger .avatar")).not.toBeNull();
    expect(app.querySelector("#account-trigger")?.textContent).toContain("Treasury");
    expect(app.querySelector("#account-trigger")?.textContent).toContain("Multisig 2 of 2");
    expect(
      app.querySelector(`[data-multisig-select="${treasury.id}"]`)?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      app
        .querySelector(`[data-switch-account="${activeAccount.id}"]`)
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  test("selecting the signer exits shared identity without a redundant account switch", async () => {
    const mounted = mount(treasury);
    mounted.app
      .querySelector<HTMLButtonElement>(`[data-switch-account="${activeAccount.id}"]`)
      ?.click();
    await Promise.resolve();
    expect(mounted.selectedSingle()).toBe(1);
    expect(mounted.switched).toEqual([]);
  });

  test("switching to another owned signer preserves the shared portfolio", async () => {
    const second = status.accounts[1];
    if (!second) throw new Error("missing second signer fixture");
    const mounted = mount(treasury);
    expect(
      mounted.app
        .querySelector(`[data-switch-account="${second.id}"]`)
        ?.getAttribute("data-selected-multisig-signer"),
    ).toBe("true");
    mounted.app.querySelector<HTMLButtonElement>(`[data-switch-account="${second.id}"]`)?.click();
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
    expect(mounted.selectedSingle()).toBe(0);
    expect(mounted.switched).toEqual([second.id]);
  });

  test("selecting another multisig changes the portfolio identity directly", () => {
    const mounted = mount(treasury);
    mounted.app
      .querySelector<HTMLButtonElement>(`[data-multisig-select="${operations.id}"]`)
      ?.click();
    expect(mounted.selectedMultisig()).toBe(operations.id);
  });
});
