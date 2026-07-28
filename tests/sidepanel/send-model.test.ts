/**
 * Send view-model coverage for felt-safe asset joins, exact balance shortcuts,
 * fiat conversion, and account-scoped recipient choices.
 */
import { describe, expect, test } from "bun:test";
import {
  balanceShortcut,
  fiatInputToken,
  sendAssets,
  sendRecipientAccounts,
  tokenInputFiat,
} from "../../src/sidepanel/send-model";
import type { WalletPreferences } from "../../src/storage/preferences-store";
import { account } from "../support/sidepanel-fixtures";

const TOKEN_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const TOKEN_ID = `SN_MAIN:ETH:${TOKEN_ADDRESS}`;
const TOKEN = {
  address: TOKEN_ADDRESS,
  decimals: 18,
  id: TOKEN_ID,
  name: "Ether",
  networkId: "SN_MAIN" as const,
  symbol: "ETH",
};

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [TOKEN],
};

describe("Send view model", () => {
  test("joins balances and felt-equivalent cached price keys without address drift", () => {
    const assets = sendAssets(
      "SN_MAIN",
      preferences,
      [
        {
          ...TOKEN,
          balance: "1250000000000000000",
          formatted: "1.25",
        },
      ],
      { [`0x0${TOKEN_ADDRESS.slice(2)}`]: 4_000 },
      { [TOKEN_ADDRESS]: 2.5 },
    );

    expect(assets).toHaveLength(1);
    expect(assets[0]?.formatted).toBe("1.25");
    expect(assets[0]?.price).toBe(4_000);
    expect(assets[0]?.change).toBe(2.5);
  });

  test("keeps raw-balance shortcuts exact at token precision", () => {
    expect(balanceShortcut("1250000", 6, "half")).toBe("0.625");
    expect(balanceShortcut("1250000", 6, "max")).toBe("1.25");
    expect(balanceShortcut("invalid", 6, "max")).toBe("");
  });

  test("converts fiat entry into a visible token amount and rejects unusable prices", () => {
    expect(fiatInputToken("100", 4_000, 18)).toBe("0.025");
    expect(fiatInputToken("100", 0, 18)).toBeNull();
    expect(tokenInputFiat("0.025", 4_000)).toBe(100);
  });

  test("excludes the active account from recipient account choices", () => {
    const second = { ...account, id: `${account.id}:second`, publicKeyX: "0x999" };
    expect(sendRecipientAccounts([account, second], "SN_MAIN", account.id)).toEqual([second]);
  });
});
