/**
 * The amount step's unit toggle names the unit it switches to: the display
 * currency while entering a token amount, the selected token while entering a
 * fiat one. Reported as a wrong ticker in the shield flow (GitHub 483): the
 * toggle kept naming a token the user had since replaced, and the currency was
 * read back from the toggle's own label, so after one round trip through fiat
 * entry a EUR or GBP user saw "USD" and was charged USD formatting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { TokenBalance } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  transferPublicBalance as eth,
  makeWallet,
  paint,
  walletStatus as status,
  transferPreferences,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const strk: TokenBalance = {
  address: STRK_TOKEN_ADDRESS,
  balance: "50000000000000000000",
  decimals: 18,
  formatted: "50",
  id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

const mount = (currency: "eur" | "gbp" | "usd") => {
  const app = document.createElement("div");
  app.id = "app";
  const preferences = {
    ...transferPreferences,
    tokens: [
      ...transferPreferences.tokens,
      {
        address: strk.address,
        decimals: 18,
        id: strk.id,
        name: strk.name,
        networkId: "SN_MAIN" as const,
        symbol: "STRK",
      },
    ],
  };
  paint(
    app,
    sendFlow(
      status,
      account,
      preferences,
      [eth, strk],
      { [eth.id]: 2000, [strk.id]: 0.5 },
      {},
      currency,
    ),
  );
  document.body.append(app);
  bindTransfer({
    app,
    publicBalances: () => [eth, strk],
    render: async () => undefined,
    wallet: makeWallet().wallet as never,
  });
  const toggle = (): void => app.querySelector<HTMLButtonElement>("#send-unit-toggle")?.click();
  const unit = (): string => app.querySelector("#send-unit-label")?.textContent ?? "";
  const unitName = (): string =>
    app.querySelector("#send-unit-toggle")?.getAttribute("aria-label") ?? "";
  const pick = (tokenId: string): void => {
    app.querySelector<HTMLButtonElement>("#send-token-trigger")?.click();
    app.querySelector<HTMLElement>(`[data-token-option="${CSS.escape(tokenId)}"]`)?.click();
  };
  return { app, pick, toggle, unit, unitName };
};

describe("send unit toggle", () => {
  test("keeps a EUR user's currency through a round trip into fiat entry", () => {
    const { toggle, unit, unitName } = mount("eur");
    expect(unit()).toBe("EUR");

    toggle();
    expect(unit()).toBe("STRK");
    expect(unitName()).toBe("Enter an amount in STRK");

    toggle();
    expect(unit()).toBe("EUR");
    expect(unitName()).toBe("Enter an amount in EUR");
  });

  test("names the newly picked token while entering a fiat amount", () => {
    const { pick, toggle, unit } = mount("gbp");
    toggle();
    expect(unit()).toBe("STRK");

    pick(eth.id);

    expect(unit()).toBe("ETH");
  });

  test("formats the fiat amount in the user's own currency", () => {
    const { app, toggle } = mount("eur");
    toggle();
    const input = app.querySelector<HTMLInputElement>("#send-amount-input");
    if (!input) throw new Error("amount input missing");
    input.value = "10";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const estimate = app.querySelector<HTMLInputElement>('input[name="fiatEstimate"]')?.value;
    expect(estimate).toContain("€");
  });
});
