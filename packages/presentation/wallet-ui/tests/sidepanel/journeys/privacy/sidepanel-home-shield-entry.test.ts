/**
 * The home Shield tile on a registered account, end to end through the real
 * screens: the tile is painted as the shield shortcut, pressing it opens Send
 * in its Shield mode on the amount step, and a Send left mid-review is never
 * what the next press resumes.
 *
 * The entrypoint's paint loop is stood in for by the few lines it really is —
 * `openSend` records the intent and navigates, `paint` renders `dashboard` for
 * the active view unless an in-flight Send is preserved, and every paint
 * re-binds — so what is exercised is the templates and bindings the extension
 * ships, in the order the entrypoint runs them.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard, type WalletView } from "../../../../src/sidepanel/app/screens/views";
import { createPrivacyController } from "../../../../src/sidepanel/journeys/privacy/privacy-controller";
import type { PrivacyAccountState } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import * as transfer from "../../../../src/sidepanel/journeys/send/transfer-bindings";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { deferred, flush, makeWallet } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  document.body.replaceChildren();
  // The recipient check and confirmation polls settle inline.
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
});

const strk: TokenConfig = {
  address: STRK_TOKEN_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [strk],
};
const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};
const publicStrk: TokenBalance = { ...strk, balance: "50000000000000000000", formatted: "50" };
const registered: PrivacyAccountState = {
  accountId: account.id,
  balances: [
    { balance: "0x0", formatted: "0", symbol: "STRK", token: strk.address, tokenId: strk.id },
  ],
  networkId: "SN_MAIN",
  poolFeeFri: "1000",
  relayConfigured: true,
  registration: "registered",
};

type Panel = {
  readonly app: HTMLElement;
  readonly navigate: (view: WalletView) => void;
  readonly view: () => WalletView;
};

const mountPanel = (walletOverrides: Record<string, unknown> = {}): Panel => {
  const app = document.createElement("main");
  app.id = "app";
  document.body.append(app);
  const { wallet } = makeWallet({
    async loadPrivacyRecipientStatus() {
      return "registered";
    },
    async loadPrivacyState() {
      return registered;
    },
    ...walletOverrides,
  });
  let activeView: WalletView = "home";
  let sendIntent: SendIntent | null = null;
  const privacy = createPrivacyController({
    app,
    balances: () => ({ balances: [publicStrk] }),
    navigate: (view) => navigate(view),
    openSend: (intent) => {
      sendIntent = intent;
      navigate("send");
    },
    paint: () => paint(),
    preferences: () => preferences,
    status: () => status,
    wallet: wallet as unknown as SidepanelWallet,
  });
  const bindAll = (): void => {
    transfer.bindTransfer({
      app,
      navigate: (view) => navigate(view),
      privacy: () => privacy.disclosure(),
      publicBalances: () => [publicStrk],
      render: async () => undefined,
      senderAddress: () => account.address,
      wallet: wallet as unknown as SidepanelWallet,
    });
    privacy.bind();
  };
  const paint = (): void => {
    if (activeView !== "send") sendIntent = null;
    if (transfer.preserveSend(app, activeView, status, [], [])) return;
    const content = dashboard(
      activeView,
      status,
      [],
      preferences,
      { balances: [publicStrk] },
      true,
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
      null,
      null,
      false,
      null,
      [],
      null,
      null,
      false,
      [],
      false,
      { balances: [] },
      null,
      privacy.disclosure(),
      privacy.journey(),
      sendIntent,
    );
    app.innerHTML = `<section class="shell">${content}</section>`;
    bindAll();
  };
  const navigate = (view: WalletView): void => {
    activeView = view;
    paint();
  };
  paint();
  return { app, navigate, view: () => activeView };
};

const click = (root: ParentNode, selector: string): void => {
  root.querySelector<HTMLElement>(selector)?.dispatchEvent(new Event("click", { bubbles: true }));
};

const stage = (app: HTMLElement): string | null =>
  app.querySelector("#transfer-form")?.getAttribute("data-stage") ?? null;

const text = (app: HTMLElement, selector: string): string =>
  app.querySelector(selector)?.textContent?.trim() ?? "";

describe("the home Shield tile on a registered account", () => {
  test("is painted as the shield shortcut once discovery has settled", async () => {
    const { app } = mountPanel();
    // Discovery runs on the first paint; the tile is the activation entry until
    // the reading lands, and the shortcut from then on.
    expect(app.querySelector("[data-privacy-open]")).not.toBeNull();
    await flush();

    expect(app.querySelector(`[data-send-shield="${strk.id}"]`)).not.toBeNull();
    expect(app.querySelector("[data-privacy-open]")).toBeNull();
  });

  test("opens Send in its Shield mode on the amount step", async () => {
    const { app, view } = mountPanel();
    await flush();

    click(app, "[data-send-shield]");

    expect(view()).toBe("send");
    expect(stage(app)).toBe("details");
    expect(text(app, "#send-header-title")).toBe("Shield");
    expect(text(app, "#send-review-button")).toBe("Review shield");
    expect(app.querySelector<HTMLInputElement>('[name="destination"]')?.value).toBe("private");
    expect(app.querySelector<HTMLInputElement>('[name="recipient"]')?.value).toBe(account.address);
    expect(app.querySelector<HTMLInputElement>('[name="tokenId"]')?.value).toBe(strk.id);
  });

  test("survives the repaints that follow the navigation", async () => {
    const { app, navigate } = mountPanel();
    await flush();
    click(app, "[data-send-shield]");

    // The entrypoint paints again after every status refresh and hydration.
    navigate("send");
    navigate("send");

    expect(stage(app)).toBe("details");
    expect(text(app, "#send-header-title")).toBe("Shield");
    expect(app.querySelector<HTMLInputElement>('[name="destination"]')?.value).toBe("private");
  });

  test("a Send left mid-review is not what the next press resumes", async () => {
    const held = deferred<unknown>();
    const { app, navigate } = mountPanel({
      preparePrivacyDeposit: () => held.promise,
    });
    await flush();
    click(app, "[data-send-shield]");
    const amount = app.querySelector<HTMLInputElement>("#send-amount-input");
    if (!amount) throw new Error("amount input missing");
    amount.value = "1";
    amount.dispatchEvent(new Event("input", { bubbles: true }));
    app
      .querySelector<HTMLFormElement>("#transfer-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(stage(app)).toBe("reviewing");
    // An in-flight review keeps its DOM through ambient repaints of Send...
    const form = app.querySelector("#transfer-form");
    navigate("send");
    expect(app.querySelector("#transfer-form")).toBe(form);

    // ...but Home is Home: leaving Send abandons the review.
    navigate("home");
    expect(app.querySelector("#transfer-form")).toBeNull();
    expect(app.querySelector("[data-send-shield]")).not.toBeNull();

    click(app, "[data-send-shield]");

    expect(stage(app)).toBe("details");
    expect(text(app, "#send-header-title")).toBe("Shield");
    expect(app.querySelector<HTMLInputElement>("#send-amount-input")?.value).toBe("");
    expect(app.querySelector<HTMLButtonElement>("#send-review-button")?.disabled).toBe(false);

    // The abandoned review's proof landing later changes nothing on the new one.
    held.resolve({ id: `sha256:${"b".repeat(64)}`, kind: "deposit" });
    await flush();
    expect(stage(app)).toBe("details");
  });
});
