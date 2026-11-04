/**
 * An expanded Activity row shows what the record holds about the
 * transaction (mc-wallet issue 480): the full counterparty, the fee the
 * account paid, the network, and the token contract. Facts the record lacks
 * are left out rather than estimated.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { STRK_TOKEN_ADDRESS, USDC_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { activityFeeText } from "../../../../src/sidepanel/journeys/portfolio/activity-detail";
import { transactionRow } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const COUNTERPARTY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const sent: ActivityEntry = {
  accountId: "account-1",
  amount: "1",
  counterparty: COUNTERPARTY,
  direction: "out",
  hash: "0x123",
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "accepted",
  submittedAt: 1752501900000,
  summary: "Sent 1 STRK",
  token: "STRK",
  tokenAddress: STRK_TOKEN_ADDRESS,
};

const facts = (html: string): Record<string, string> => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return Object.fromEntries(
    [...root.querySelectorAll(".disclosure-body .request-detail > div")].map((row) => [
      row.querySelector("dt")?.textContent ?? "",
      row.querySelector("dd code")?.textContent ?? row.querySelector("dd")?.textContent ?? "",
    ]),
  );
};

describe("the expanded Activity row", () => {
  test("shows the whole counterparty, the network and the token contract", () => {
    const shown = facts(transactionRow(sent));

    expect(shown["Recipient"] ?? shown["To"]).toBe(COUNTERPARTY);
    expect(shown["Network"]).toBe("Starknet Mainnet");
    expect(shown["Token contract"]).toBe(STRK_TOKEN_ADDRESS);
  });

  test("makes the token contract copyable", () => {
    expect(transactionRow(sent)).toContain(`data-copy="${STRK_TOKEN_ADDRESS}"`);
    expect(transactionRow(sent)).toContain('aria-label="Copy token contract address"');
  });

  test("shows the fee the receipt recorded", () => {
    const html = transactionRow({
      ...sent,
      feePaid: { amount: "0x2386f26fc10000", unit: "FRI" },
    });

    expect(facts(html)["Network fee"]).toBe("0.01 STRK");
  });

  test("leaves out facts the record does not hold", () => {
    const { tokenAddress: _address, ...legacy } = sent;
    const shown = facts(transactionRow(legacy));

    // No fee estimate and no fiat value at today's price stand in for them.
    expect(Object.keys(shown)).toEqual(["Transaction", "Recipient", "Network", "Submitted"]);
  });
});

describe("activityFeeText", () => {
  test("reads an ETH-paid receipt fee in ETH", () => {
    expect(activityFeeText({ ...sent, feePaid: { amount: "0x2386f26fc10000", unit: "WEI" } })).toBe(
      "0.01 ETH",
    );
  });

  test("says a sponsored fee was not the account's", () => {
    expect(
      activityFeeText({
        ...sent,
        feePaid: { amount: "0x1", unit: "FRI" },
        feePayer: "sponsor",
      }),
    ).toBe("Sponsored");
  });

  test("shows a gasless fee in the token the user signed it in", () => {
    expect(
      activityFeeText({
        ...sent,
        userFee: { amount: "250000", token: "USDC", tokenAddress: USDC_TOKEN_ADDRESS },
      }),
    ).toBe("0.25 USDC");
  });

  test("reads a STRK-paid receipt fee in STRK", () => {
    expect(activityFeeText({ ...sent, feePaid: { amount: "0x2386f26fc10000", unit: "FRI" } })).toBe(
      "0.01 STRK",
    );
  });

  test("takes a gasless fee token's scale from the user's tracked tokens", () => {
    const entry: ActivityEntry = {
      ...sent,
      userFee: { amount: "150000", token: "ODD", tokenAddress: "0xabc" },
    };
    const odd = {
      address: "0xabc",
      decimals: 5,
      id: "SN_MAIN:0xabc",
      name: "Odd",
      networkId: "SN_MAIN" as const,
      symbol: "ODD",
    };

    expect(activityFeeText(entry, [odd])).toBe("1.5 ODD");
    // The scale belongs to that network's contract, not to an address that
    // happens to match on another network.
    expect(activityFeeText(entry, [{ ...odd, networkId: "SN_SEPOLIA" }])).toBeNull();
  });

  test("shows no gasless fee for a token whose scale it doesn't know", () => {
    expect(
      activityFeeText({
        ...sent,
        userFee: { amount: "250000", token: "ODD", tokenAddress: "0xabc" },
      }),
    ).toBeNull();
  });

  test("shows no fee for a malformed stored amount", () => {
    expect(
      activityFeeText({
        ...sent,
        userFee: { amount: "not-a-number", token: "USDC", tokenAddress: USDC_TOKEN_ADDRESS },
      }),
    ).toBeNull();
  });

  test("shows no fee when none was recorded", () => {
    expect(activityFeeText(sent)).toBeNull();
  });
});
