/**
 * A co-owner reviews an incoming CallSet authorization and signs it. The token
 * they spend is one the wallet already tracks, sent through as its token id.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { TokenBalance } from "@bramble/starknet/rpc";
import { showMultisigStrk20Authorizations } from "../../../../src/sidepanel/journeys/multisig/multisig-strk20-key-ui";
import { multisigStrk20KeyPanel } from "../../../../src/sidepanel/journeys/multisig/multisig-strk20-key-view";
import { isStrk20Panel } from "../../../../src/sidepanel/journeys/multisig/multisig-strk20-panel";
import { makeArgentMultisigFixture } from "../../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flushMultisigUi,
  makeMultisigUiClient,
  mountMultisigUi,
} from "../../../support/multisig-ui-harness";

const RECIPIENT = "0x123";

beforeAll(registerDom);
afterAll(unregisterDom);

const card = (
  id: string,
  offer: "send" | "share" | "sign",
  lines: readonly string[],
  refresh = false,
) => ({
  id,
  lines,
  offer,
  refresh,
  summary: "compile_actions",
});

describe("incoming multisig CallSet review", () => {
  test("refuses a panel reply that is not a reviewable authorization", () => {
    expect(isStrk20Panel({ authorizations: [{ id: "auth-1" }], balances: [], ok: true })).toBe(
      false,
    );
    expect(
      isStrk20Panel({
        authorizations: [],
        balances: [{ balance: "0x1", formatted: "1", symbol: "USDC", token: "0x2", tokenId: "id" }],
        ok: true,
        relays: [],
      }),
    ).toBe(true);
    expect(
      isStrk20Panel({
        authorizations: [],
        balances: [],
        ok: true,
      }),
    ).toBe(false);
  });

  test("shows the hashed calls, and signs or shares that card", () => {
    const list = document.createElement("div");
    const signed: string[] = [];
    const shared: string[] = [];
    showMultisigStrk20Authorizations(
      list,
      [card("auth-1", "sign", ["USDC", "0x16e360", RECIPIENT]), card("auth-2", "share", [])],
      {
        onRefresh: () => undefined,
        onSend: () => undefined,
        onShare: (id) => shared.push(id),
        onSign: (id) => signed.push(id),
      },
    );
    const cards = [...list.querySelectorAll("article")];
    expect(cards[0]?.textContent).toContain("compile_actions");
    expect(cards[0]?.textContent).toContain("USDC");
    expect(cards[0]?.textContent).toContain("0x16e360");
    expect(cards[0]?.textContent).toContain(RECIPIENT);
    expect(cards[0]?.textContent).not.toContain("Transfer from this multisig's private balance");
    cards[0]?.querySelector("button")?.click();
    expect(signed).toEqual(["auth-1"]);
    expect(cards[1]?.querySelector("button")?.textContent).toBe("Share");
    cards[1]?.querySelector("button")?.click();
    expect(shared).toEqual(["auth-2"]);
  });

  test("prepares a transfer of the tracked token the co-owner picked", async () => {
    const preferences = defaultWalletPreferences();
    const usdc = preferences.tokens.find(
      (token) => token.symbol === "USDC" && token.networkId === "SN_MAIN",
    );
    if (!usdc) throw new Error("USDC is tracked on mainnet");
    const balance: TokenBalance = { ...usdc, balance: "1500000", formatted: "1.5" };
    const fixture = await makeArgentMultisigFixture();
    const prepared: unknown[] = [];
    const html = multisigStrk20KeyPanel("SN_MAIN", preferences, {
      balances: { balances: [balance] },
      changes: {},
      currency: "usd",
      prices: {},
    });
    const client = await makeMultisigUiClient({
      prepareStrk20: async (input) => {
        prepared.push(input);
        return { id: "auth-1", phase: "authorization" as const };
      },
      strk20KeyStatus: async () => "held",
      strk20Panel: async () => ({
        authorizations: [card("auth-1", "sign", ["USDC", "0x16e360", RECIPIENT])],
        balances: [
          {
            balance: "0x16e360",
            formatted: "2",
            symbol: "USDC",
            token: usdc.address,
            tokenId: usdc.id,
          },
        ],
        relays: [],
      }),
    });
    const app = mountMultisigUi(html, client, fixture.status, {
      selectedMultisigId: () => fixture.record.id,
    });
    await flushMultisigUi();
    expect(app.querySelector("[data-ms-strk20-sign]")?.textContent).toBe("Sign");
    app.querySelector<HTMLButtonElement>('[data-ms-strk20-action="transfer"]')?.click();
    const option = app.querySelector<HTMLOptionElement>(`option[value="${usdc.id}"]`);
    expect(option?.textContent).toContain("USDC");
    expect(option?.textContent).toContain("2");
    const select = app.querySelector<HTMLSelectElement>('select[name="tokenId"]');
    if (select) select.value = usdc.id;
    const amount = app.querySelector<HTMLInputElement>('input[name="amount"]');
    if (amount) amount.value = "1.5";
    const recipient = app.querySelector<HTMLInputElement>('input[name="recipient"]');
    if (recipient) recipient.value = RECIPIENT;
    app.querySelector<HTMLFormElement>("[data-ms-strk20-form]")?.requestSubmit();
    await flushMultisigUi();
    expect(prepared).toEqual([
      {
        amount: "1.5",
        kind: "transfer",
        multisigId: fixture.record.id,
        recipient: RECIPIENT,
        tokenId: usdc.id,
      },
    ]);
    app.querySelector<HTMLButtonElement>('[data-ms-strk20-action="deposit"]')?.click();
    app.querySelector<HTMLFormElement>("[data-ms-strk20-form]")?.requestSubmit();
    await flushMultisigUi();
    expect(prepared[1]).toEqual({
      amount: "1.5",
      kind: "deposit",
      multisigId: fixture.record.id,
      tokenId: usdc.id,
    });
    expect(option?.textContent).toContain("1.5");
  });

  test("a signed CallSet offers Share, and a reloaded relay can be sent", async () => {
    const fixture = await makeArgentMultisigFixture();
    let signed = false;
    const shared: string[] = [];
    const sent: string[] = [];
    const html = multisigStrk20KeyPanel("SN_MAIN", defaultWalletPreferences(), {
      balances: { balances: [] },
      changes: {},
      currency: "usd",
      prices: {},
    });
    const client = await makeMultisigUiClient({
      shareStrk20Authorization: async (id) => {
        shared.push(id);
        return { recipients: 1, totalRecipients: 1 };
      },
      signStrk20Authorization: async () => {
        signed = true;
        return { id: "auth-1", phase: "authorization" as const };
      },
      strk20KeyStatus: async () => "held",
      strk20Panel: async () => ({
        authorizations: [card("auth-1", signed ? "share" : "sign", ["0x10"])],
        balances: [],
        relays: [card("relay-1", "send", ["USDC"], true)],
      }),
      submitStrk20Relay: async (id) => {
        sent.push(id);
        return { transactionHash: "0xabc" };
      },
    });
    const app = mountMultisigUi(html, client, fixture.status, {
      selectedMultisigId: () => fixture.record.id,
    });
    await flushMultisigUi();
    expect(app.querySelector("[data-ms-strk20-send]")?.textContent).toBe("Send");
    expect(app.querySelector("[data-ms-strk20-refresh]")?.textContent).toBe("Refresh");
    app.querySelector<HTMLButtonElement>("[data-ms-strk20-send]")?.click();
    await flushMultisigUi();
    expect(sent).toEqual(["relay-1"]);
    app.querySelector<HTMLButtonElement>("[data-ms-strk20-sign]")?.click();
    await flushMultisigUi();
    expect(app.querySelector("[data-ms-strk20-share]")?.textContent).toBe("Share");
    app.querySelector<HTMLButtonElement>("[data-ms-strk20-share]")?.click();
    await flushMultisigUi();
    expect(shared).toEqual(["auth-1"]);
  });
});

describe("multisig private balances key state", () => {
  const panel = () =>
    multisigStrk20KeyPanel("SN_MAIN", defaultWalletPreferences(), {
      balances: { balances: [] },
      changes: {},
      currency: "usd",
      prices: {},
    });
  const loadingLine = (app: ParentNode) =>
    app.querySelector<HTMLElement>("[data-ms-strk20-key-loading]");
  const shownKeyButtons = (app: ParentNode) =>
    [...app.querySelectorAll<HTMLButtonElement>("[data-ms-strk20-key]")]
      .filter((button) => !button.hidden)
      .map((button) => button.dataset["msStrk20Key"]);

  test("says it is loading until the key state arrives, with no action offered", () => {
    const html = panel();
    expect(html).toContain("Loading…");
    expect(html).toContain('role="status"');
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(shownKeyButtons(host)).toEqual([]);
  });

  test("replaces the loading line with the actions the key state allows", async () => {
    const fixture = await makeArgentMultisigFixture();
    let answer: (state: "absent") => void = () => undefined;
    const client = await makeMultisigUiClient({
      strk20KeyStatus: () => new Promise((resolve) => (answer = resolve)),
    });
    const app = mountMultisigUi(panel(), client, fixture.status, {
      selectedMultisigId: () => fixture.record.id,
    });
    await flushMultisigUi();
    expect(loadingLine(app)?.textContent).toBe("Loading…");
    answer("absent");
    await flushMultisigUi();
    expect(loadingLine(app)).toBeNull();
    expect(shownKeyButtons(app)).toEqual(["create"]);
  });

  test("a failed read shows its reason as an alert instead of staying blank", async () => {
    const fixture = await makeArgentMultisigFixture();
    const client = await makeMultisigUiClient({
      strk20KeyStatus: async () => {
        throw new Error("strk20 key status unavailable");
      },
    });
    const app = mountMultisigUi(panel(), client, fixture.status, {
      selectedMultisigId: () => fixture.record.id,
    });
    await flushMultisigUi();
    const line = loadingLine(app);
    expect(line?.getAttribute("role")).toBe("alert");
    expect(line?.textContent).not.toBe("Loading…");
    expect(line?.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(shownKeyButtons(app)).toEqual([]);
  });
});
