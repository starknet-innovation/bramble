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
      }),
    ).toBe(true);
  });

  test("shows the action, token, amount, and recipient, and signs that request", () => {
    const list = document.createElement("div");
    const signed: string[] = [];
    showMultisigStrk20Authorizations(
      list,
      [
        {
          amount: "1.5",
          id: "auth-1",
          kind: "transfer",
          recipient: RECIPIENT,
          summary: "Transfer from this multisig's private balance",
          symbol: "USDC",
          youSigned: false,
        },
        {
          amount: "",
          id: "auth-2",
          kind: "register",
          summary: "Register this multisig's private balance",
          symbol: "",
          youSigned: true,
        },
      ],
      (id) => signed.push(id),
    );
    const cards = [...list.querySelectorAll("article")];
    expect(cards[0]?.textContent).toContain("Transfer from this multisig's private balance");
    expect(cards[0]?.textContent).toContain("1.5 USDC");
    expect(cards[0]?.textContent).toContain(`To ${RECIPIENT}`);
    cards[0]?.querySelector("button")?.click();
    expect(signed).toEqual(["auth-1"]);
    expect(cards[1]?.textContent).toContain("You signed. Waiting for co-owners.");
    expect(cards[1]?.querySelector("button")).toBeNull();
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
        authorizations: [
          {
            amount: "1.5",
            id: "auth-1",
            kind: "transfer" as const,
            recipient: RECIPIENT,
            summary: "Transfer from this multisig's private balance",
            symbol: "USDC",
            youSigned: false,
          },
        ],
        balances: [
          {
            balance: "0x16e360",
            formatted: "2",
            symbol: "USDC",
            token: usdc.address,
            tokenId: usdc.id,
          },
        ],
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
});
