/**
 * Flow template branches not reached by the default (empty) fixtures: the
 * account details "Account type" block for a recognised class hash, and the
 * send-flow token/recipient list callbacks that only run with non-empty tokens
 * and address book entries.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { accountFlow, sendFlow } from "../src/sidepanel/flows";
import type { WalletPreferences } from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";
import { account, preferences } from "./support/sidepanel-fixtures";

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

// The OpenZeppelin AccountUpgradeable preset class hash the registry maps to a
// friendly label, so knownAccountType(...) is non-null and the type block renders.
const OZ_CLASS_HASH = "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";

describe("accountFlow account-type block", () => {
  test("renders the account type when the class hash is recognised", () => {
    const knownAccount: AccountRef = { ...account, classHash: OZ_CLASS_HASH };
    const knownStatus: WalletStatus = { ...status, accounts: [knownAccount] };

    const html = accountFlow(knownStatus, knownAccount, preferences);

    // The identifiers render as a receipt: a "Type" row carries the label.
    expect(html).toContain("<dt>Type</dt>");
    expect(html).toContain("OpenZeppelin (AccountUpgradeable)");
  });

  test("omits the account type for an unrecognised class hash", () => {
    // The default fixture account carries an arbitrary (unknown) class hash.
    const html = accountFlow(status, account, preferences);
    expect(html).not.toContain("<dt>Type</dt>");
  });
});

describe("sendFlow list callbacks", () => {
  test("renders one option per tracked token and one datalist entry per saved address", () => {
    const withData: WalletPreferences = {
      ...preferences,
      addressBook: [
        { address: "0xaaa1", id: "SN_MAIN:0xaaa1", label: "Ada", networkId: "SN_MAIN" },
        { address: "0xbbb2", id: "SN_SEPOLIA:0xbbb2", label: "Grace", networkId: "SN_SEPOLIA" },
      ],
      tokens: [
        {
          address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
          decimals: 18,
          id: "SN_MAIN:ETH",
          name: "Ether",
          networkId: "SN_MAIN",
          symbol: "ETH",
        },
        {
          address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
          decimals: 18,
          id: "SN_SEPOLIA:STRK",
          name: "Starknet Token",
          networkId: "SN_SEPOLIA",
          symbol: "STRK",
        },
      ],
    };

    const html = sendFlow(status, account, withData);

    // Only the mainnet token/address survive the network filter, and each runs
    // through the map callback that builds an <option>.
    expect(html).toContain('<option value="SN_MAIN:ETH">ETH — Ether</option>');
    expect(html).not.toContain("SN_SEPOLIA:STRK");
    expect(html).toContain('<option value="0xaaa1">Ada</option>');
    expect(html).not.toContain("Grace");
    // With a token available the form is enabled (canSend).
    expect(html).not.toMatch(/name="tokenId"[^>]*disabled/);
  });

  test("disables the form and lists no tokens when the network has none", () => {
    const html = sendFlow(status, account, preferences);
    expect(html).toContain("No tokens are tracked on this network yet");
    expect(html).toMatch(/name="tokenId"[^>]*disabled/);
  });
});
