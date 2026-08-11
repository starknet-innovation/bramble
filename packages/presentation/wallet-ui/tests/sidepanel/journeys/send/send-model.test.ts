/**
 * Send view-model coverage for felt-safe asset joins, exact balance shortcuts,
 * fiat conversion, and account-scoped recipient choices.
 */
import { describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { account } from "@mc-wallet/testkit/sidepanel";
import {
  balanceShortcut,
  fiatInputToken,
  sendAssets,
  sendRecipientAccounts,
  tokenInputFiat,
} from "../../../../src/sidepanel/journeys/send/send-model";
import { tokenFiatValue } from "../../../../src/sidepanel/shared/fiat";

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

  test("keeps a missing balance unread instead of fabricating zero", () => {
    const [asset] = sendAssets("SN_MAIN", preferences, [], {}, {});

    expect(asset?.balance).toBe("");
    expect(asset?.formatted).toBe("");
    expect(tokenFiatValue(asset?.formatted ?? "", 4_000)).toBeNull();
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

  test("offers the sending account as a recipient, for shielding into its own balance", () => {
    // Sending to yourself is how value moves from a public balance into the same
    // account's private one, so the origin has to be selectable. The view marks
    // it; the model does not hide it.
    const second = { ...account, id: `${account.id}:second`, publicKeyX: "0x999" };
    expect(sendRecipientAccounts([account, second], "SN_MAIN")).toEqual([account, second]);
  });

  test("still keeps recipients to the active network", () => {
    const elsewhere = { ...account, id: `${account.id}:sepolia`, networkId: "SN_SEPOLIA" } as const;
    expect(sendRecipientAccounts([account, elsewhere], "SN_MAIN")).toEqual([account]);
  });
});
