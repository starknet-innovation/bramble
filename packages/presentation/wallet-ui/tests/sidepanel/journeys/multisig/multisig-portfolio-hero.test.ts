/**
 * The watched multisig hero carries the same 24h explanation as Home: the
 * caption renders only with a priced baseline and names the figure a price move
 * at the current balances.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { TokenBalance } from "../../../../src/popup/responses/responses";
import {
  type MultisigPortfolioData,
  multisigPortfolio,
} from "../../../../src/sidepanel/journeys/multisig/multisig-portfolio";

const record: ArgentMultisigRecord = {
  accountContractType: "argent-multisig",
  address: "0x999",
  classHash: "0x123",
  id: "SN_MAIN:0x999",
  name: "Treasury",
  networkId: "SN_MAIN",
};

const balance: TokenBalance = {
  address: "0x00aa",
  balance: "10000000000000000000",
  decimals: 18,
  formatted: "10",
  id: "SN_MAIN:TKN:0x00aa",
  name: "Token",
  networkId: "SN_MAIN",
  symbol: "TKN",
};

const render = (data: MultisigPortfolioData): string =>
  multisigPortfolio({
    authorityAvailable: true,
    canPropose: true,
    data,
    intentList: { emptyMessage: "No intents", heading: "Intents", items: [] },
    openCount: 0,
    preferences: defaultWalletPreferences(),
    record,
    signerKnown: true,
  });

describe("multisig portfolio hero caption", () => {
  test("names the 24h figure a price move when a balance is priced", () => {
    const html = render({
      balances: { balances: [balance] },
      changes: { "0x00aa": 4 },
      currency: "usd",
      prices: { "0x00aa": 5 },
    });

    expect(html).toContain("Portfolio price · 4.00% · 24h");
    expect(html).toContain('class="hero-note"');
    expect(html).toContain(
      "Price change over 24h at your current balances; sends and receives aren't included.",
    );
  });

  test("omits the caption when no balance is priced", () => {
    // Prices exist but match no balance, so portfolioDelta is null and the gate
    // must suppress the caption; removing the gate renders it here.
    const html = render({
      balances: { balances: [balance] },
      changes: {},
      currency: "usd",
      prices: { "0x00bb": 5 },
    });

    expect(html).not.toContain("hero-note");
    expect(html).not.toContain("Portfolio price");
  });
});
