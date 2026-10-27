/**
 * The real side-panel composition root (`startWalletUi`) announces a network
 * change on its root as soon as it renders the new status, so a network-scoped
 * form (the Ready-key picker) drops its list even when the repaint is skipped
 * because the markup did not change, or deferred until the new network's data
 * loads. The first status rendered is no change.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { startWalletUi } from "../../../src/sidepanel/app/start";
import type { RuntimeApi } from "../../../src/sidepanel/runtime/runtime-types";
import { onNetworkChange } from "../../../src/sidepanel/shared/network-change";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let round = 0; round < 8; round += 1) await tick();
};

type HappyWindow = { readonly happyDOM: { readonly setURL: (url: string) => void } };
const setUrl = (url: string): void => (window as unknown as HappyWindow).happyDOM.setURL(url);

const lockedOn = (networkId: WalletStatus["networkId"]): WalletStatus => ({
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: true,
  network: networkId,
  networkId,
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
});

const ledger = {
  openConnected: async () => null,
  request: async () => {
    throw new Error("no Ledger in this test");
  },
};

afterEach(() => {
  setUrl("about:blank");
});

describe("network change through startWalletUi", () => {
  test("a refreshed status on another network is announced once", async () => {
    let networkId: WalletStatus["networkId"] = "SN_MAIN";
    type Listener = Parameters<NonNullable<RuntimeApi["onMessage"]>["addListener"]>[0];
    const listeners: Listener[] = [];
    const browser = {
      runtime: {
        onMessage: {
          addListener: (listener: Listener) => {
            listeners.push(listener);
          },
        },
        sendMessage: async (message: unknown) =>
          (message as { readonly type?: string }).type === "wallet.status"
            ? lockedOn(networkId)
            : null,
      },
      sidePanel: { open: async () => undefined },
      sidebarAction: { open: async () => undefined },
      windows: { WINDOW_ID_CURRENT: -2 },
    };
    setUrl("chrome-extension://bramble/sidepanel.html");
    document.body.innerHTML = `<main id="app"></main><form id="owner"></form>`;
    let heard = 0;
    onNetworkChange(document.querySelector("#app"), document.querySelector("#owner"), () => {
      heard += 1;
    });
    await startWalletUi(ledger, browser);
    await settle();
    expect(heard).toBe(0);

    networkId = "SN_SEPOLIA";
    const event = {
      chainId: "0x534e5f5345504f4c4941",
      event: "networkChanged",
      type: "wallet.event",
    };
    for (const listener of listeners) listener(event, { id: "bramble" });
    await settle();
    expect(heard).toBe(1);
  });

  test("announces a network switch before the deferred repaint lands", async () => {
    // A switch in an unlocked wallet repaints only after the new network's
    // data loads. Until then the old network's picker must already be gone,
    // or Import selected writes the previous network's accounts.
    let networkId: WalletStatus["networkId"] = "SN_MAIN";
    let stall = false;
    type Listener = Parameters<NonNullable<RuntimeApi["onMessage"]>["addListener"]>[0];
    const listeners: Listener[] = [];
    const browser = {
      runtime: {
        onMessage: {
          addListener: (listener: Listener) => {
            listeners.push(listener);
          },
        },
        sendMessage: async (message: unknown) => {
          if ((message as { readonly type?: string }).type === "wallet.status") {
            return lockedOn(networkId);
          }
          return stall ? new Promise<never>(() => undefined) : null;
        },
      },
      sidePanel: { open: async () => undefined },
      sidebarAction: { open: async () => undefined },
      windows: { WINDOW_ID_CURRENT: -2 },
    };
    setUrl("chrome-extension://bramble/sidepanel.html");
    document.body.innerHTML = `<main id="app"></main><form id="owner"></form>`;
    let heard = 0;
    onNetworkChange(document.querySelector("#app"), document.querySelector("#owner"), () => {
      heard += 1;
    });
    await startWalletUi(ledger, browser);
    await settle();
    expect(heard).toBe(0);

    networkId = "SN_SEPOLIA";
    stall = true;
    const event = {
      chainId: "0x534e5f5345504f4c4941",
      event: "networkChanged",
      type: "wallet.event",
    };
    for (const listener of listeners) listener(event, { id: "bramble" });
    await settle();
    expect(heard).toBe(1);
  });
});
