/**
 * The real side-panel composition root (`startWalletUi`) closes the finished
 * onboarding tab only once the guarded phrase copy has actually been cleared
 * (mc-wallet #473 item 2). A refused clear, or a copy on a browser that cannot
 * clear (Firefox), keeps the tab open and says why instead of closing as if
 * the phrase had left the clipboard.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { startWalletUi } from "../../../src/sidepanel/app/start";
import {
  bindGuardedCopy,
  GUARDED_COPY_CLEAR_MS,
  resetGuardedCopyClearForTests,
} from "../../../src/sidepanel/shared/guarded-copy";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type HappyWindow = { readonly happyDOM: { readonly setURL: (url: string) => void } };
const setUrl = (url: string): void => (window as unknown as HappyWindow).happyDOM.setURL(url);

/** A wallet that has just finished setup: the full page shows completion. */
const finishedSetup: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const ledger = {
  openConnected: async () => null,
  request: async () => {
    throw new Error("no Ledger in this test");
  },
};

const browser = {
  runtime: {
    sendMessage: async (message: unknown) =>
      (message as { readonly type?: string }).type === "wallet.status" ? finishedSetup : null,
  },
  sidePanel: { open: async () => undefined },
  sidebarAction: { open: async () => undefined },
  windows: { WINDOW_ID_CURRENT: -2 },
};

let closed = 0;
let clears: Array<() => void> = [];
let rejectClear = false;
let realSetTimeout: typeof window.setTimeout;

beforeEach(() => {
  closed = 0;
  clears = [];
  rejectClear = false;
  resetGuardedCopyClearForTests();
  document.body.className = "onboarding-surface";
  document.body.innerHTML = `<main id="app"></main>`;
  Object.defineProperty(window, "close", {
    configurable: true,
    value: () => {
      closed += 1;
    },
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        if (value === "" && rejectClear) {
          throw new Error("Document is not focused");
        }
      },
    },
  });
  realSetTimeout = window.setTimeout;
  Object.defineProperty(window, "setTimeout", {
    configurable: true,
    value: (callback: () => void, delay?: number) => {
      if (delay === GUARDED_COPY_CLEAR_MS) {
        clears.push(callback);
        return 0;
      }
      return realSetTimeout(callback, delay);
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "setTimeout", { configurable: true, value: realSetTimeout });
  setUrl("about:blank");
});

/** Copies the phrase the way the onboarding "Save your recovery phrase" step does. */
const copyPhrase = async (): Promise<void> => {
  const button = document.createElement("button");
  document.body.append(button);
  bindGuardedCopy(button, () => "secret recovery words");
  button.click();
  await tick();
  button.remove();
};

const completionStatus = (): string =>
  document.querySelector("#onboarding-complete-result")?.textContent ?? "";

const settle = async (): Promise<void> => {
  for (let round = 0; round < 5; round += 1) {
    await tick();
  }
};

describe("onboarding completion close through startWalletUi", () => {
  test("closes the tab when nothing was copied", async () => {
    setUrl("chrome-extension://bramble/onboarding.html");
    await startWalletUi(ledger, browser);
    await settle();
    expect(document.querySelector("#onboarding-open-wallet")).not.toBeNull();
    expect(closed).toBe(1);
  });

  test("waits for the clear, then closes", async () => {
    setUrl("chrome-extension://bramble/onboarding.html");
    await copyPhrase();
    await startWalletUi(ledger, browser);
    await settle();
    expect(closed).toBe(0);
    expect(completionStatus()).toContain("stays open until the clipboard clear finishes");
    clears[0]?.();
    await settle();
    expect(closed).toBe(1);
  });

  test("keeps the tab open and says so when the clear is refused", async () => {
    setUrl("chrome-extension://bramble/onboarding.html");
    await copyPhrase();
    await startWalletUi(ledger, browser);
    await settle();
    rejectClear = true;
    clears[0]?.();
    await settle();
    expect(closed).toBe(0);
    expect(completionStatus()).toBe(
      "Couldn't clear the clipboard. Copy something else to overwrite it. Then close this tab.",
    );
  });

  test("keeps the tab open after a copy on a browser that cannot clear", async () => {
    setUrl("moz-extension://bramble/onboarding.html");
    await copyPhrase();
    expect(clears).toHaveLength(0);
    await startWalletUi(ledger, browser);
    await settle();
    expect(closed).toBe(0);
    expect(completionStatus()).toContain("Couldn't clear the clipboard");
  });
});
