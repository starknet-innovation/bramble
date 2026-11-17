/**
 * Allowance amounts are stored in base units and rendered through the tracked
 * token's decimals. Spec item 7: 1,000 USDC once rendered as 1,000,000,000.
 */
import { describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { AllowanceView } from "@bramble/transactions/allowance-discovery";
import { UINT128_LIMIT } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { allowancesFlow } from "../../../../src/sidepanel/journeys/portfolio/allowance-views";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const ZERO_DECIMALS = "0x0123";
const UNTRACKED = "0x0999";
const SPENDER = "0x0abc";

const listed = (entries: readonly AllowanceView[]) => ({
  entries,
  notices: [],
  unavailable: false,
});

const tokens = [
  {
    address: USDC,
    decimals: 6,
    id: "usdc",
    name: "USD Coin",
    networkId: account.networkId,
    symbol: "USDC",
  },
  {
    address: ETH,
    decimals: 18,
    id: "eth",
    name: "Ether",
    networkId: account.networkId,
    symbol: "ETH",
  },
  {
    address: ZERO_DECIMALS,
    decimals: 0,
    id: "zero",
    name: "Tickets",
    networkId: account.networkId,
    symbol: "TIX",
  },
];

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Sepolia",
  networkId: account.networkId,
  networks: [{ id: account.networkId, name: "Starknet Sepolia" }],
  ready: true,
};

const allowance = (
  overrides: Partial<AllowanceView> & { readonly amount: string },
): AllowanceView => ({
  accountId: account.id,
  id: `allowance-${overrides.amount}`,
  networkId: account.networkId,
  source: "wallet",
  spender: SPENDER,
  token: USDC,
  ...overrides,
});

const amountText = (view: AllowanceView): string => {
  const html = allowancesFlow(status, account, listed([view]), { ...preferences, tokens });
  const match = html.match(/<span class="allowance-amount"[^>]*>([^<]*)<\/span>/);
  if (!match?.[1]) {
    throw new Error("allowance amount not rendered");
  }
  return match[1];
};

describe("allowance amounts", () => {
  test("renders 1,000 USDC at six decimals as 1,000 USDC, never as base units", () => {
    expect(amountText(allowance({ amount: "1000000000" }))).toBe("1,000 USDC");
  });

  test("scales 18-decimal and 0-decimal tokens by their own decimals", () => {
    expect(amountText(allowance({ amount: "1500000000000000000", token: ETH }))).toBe("1.5 ETH");
    expect(amountText(allowance({ amount: "42", token: ZERO_DECIMALS }))).toBe("42 TIX");
  });

  test("labels an untracked contract in raw base units instead of guessing decimals", () => {
    expect(amountText(allowance({ amount: "1000000000", token: UNTRACKED }))).toBe(
      "1,000,000,000 base units",
    );
  });

  test("keeps tiny values and large integers exact, without floating point", () => {
    expect(amountText(allowance({ amount: "1" }))).toMatch(/^0\.0+1 USDC$/);
    expect(amountText(allowance({ amount: "1000000000000000000000000000000" }))).toBe(
      "1,000,000,000,000,000,000,000,000 USDC",
    );
  });

  test("preserves the lower-bound, unknown-amount, and unlimited labels", () => {
    expect(amountText(allowance({ amount: "1000000000", lowerBound: true }))).toBe(
      "at least 1,000 USDC",
    );
    expect(amountText(allowance({ amount: "0", lowerBound: true }))).toBe("an unknown amount");
    expect(amountText(allowance({ amount: UINT128_LIMIT.toString() }))).toBe("Unlimited");
  });

  test("matches the token on the canonical felt, not the spelling of the address", () => {
    expect(amountText(allowance({ amount: "1000000000", token: USDC.replace("0x0", "0x") }))).toBe(
      "1,000 USDC",
    );
  });

  test("keeps the token contract address reachable beside a known symbol", () => {
    const html = allowancesFlow(status, account, listed([allowance({ amount: "1000000000" })]), {
      ...preferences,
      tokens,
    });
    expect(html).toContain(`title="${USDC}"`);
    expect(html).toContain("Copy token contract address");
  });
});
