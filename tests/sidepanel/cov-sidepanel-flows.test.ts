/**
 * Flow template branches not reached by the default (empty) fixtures: the
 * account details "Account type" block for a recognised class hash, and the
 * send-flow token/recipient list callbacks that only run with non-empty tokens
 * and address book entries.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { accountFlow, backupFlow, sendFlow } from "../../src/sidepanel/flows";
import type { WalletPreferences } from "../../src/storage/preferences-store";
import type { AccountRef } from "../../src/storage/vault-schema";
import { account, preferences } from "../support/sidepanel-fixtures";

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
    // through the picker row callback.
    expect(html).toContain('data-send-asset="SN_MAIN:ETH"');
    expect(html).toContain('data-send-symbol="ETH"');
    expect(html).not.toContain("SN_SEPOLIA:STRK");
    expect(html).toContain('data-send-recipient="0xaaa1"');
    expect(html).toContain('data-send-recipient-label="Ada"');
    expect(html).not.toContain("Grace");
    expect(html).toMatch(/send-network-context[\s\S]*?send-network-mark[\s\S]*?class="token-logo"/);
    expect(html).toMatch(
      /<dt>Network<\/dt><dd class="network-inline-value">[\s\S]*?class="token-logo"/,
    );
    // With a token available the form is enabled (canSend).
    expect(html).not.toMatch(/id="send-token-trigger"[^>]*disabled/);
  });

  test("disables the form and lists no tokens when the network has none", () => {
    const html = sendFlow(status, account, preferences);
    expect(html).toContain("No tokens are tracked on this network yet");
    expect(html).toMatch(/id="send-token-trigger"[^>]*disabled/);
  });

  test("lists watched multisigs with account recipients on the active network", () => {
    const html = sendFlow(status, account, preferences, [], {}, {}, "usd", [
      {
        address: "0x999",
        id: "SN_MAIN:0x999",
        name: "Operations",
        networkId: "SN_MAIN",
        quorum: 2,
        signers: ["0x1", "0x2", "0x3"],
      },
      {
        address: "0x888",
        id: "SN_SEPOLIA:0x888",
        networkId: "SN_SEPOLIA",
        quorum: 1,
        signers: ["0x1"],
      },
    ]);
    expect(html).toContain('data-send-recipient="0x999"');
    expect(html).toContain("Operations");
    expect(html).toContain("2 of 3 signers required");
    expect(html).not.toContain('data-send-recipient="0x888"');
  });
});

describe("backupFlow Ledger recovery warning", () => {
  test("warns a mixed wallet that its recovery phrase does not restore Ledger accounts", () => {
    const ledgerAccount: AccountRef = {
      ...account,
      derivation: {
        accountIndex: 0,
        eip2645application: "LedgerW",
        kind: "ledger",
        path: "m/2645'/1195502025'/734980059'/0'/0'/0",
      },
      id: "SN_MAIN:0x987",
      address: "0x987",
    };

    const html = backupFlow({
      ...status,
      accountCount: 2,
      accounts: [account, ledgerAccount],
    });

    expect(html).toContain("Ledger accounts are not restored");
    expect(html).toContain("Ledger recovery phrase");
  });

  test("does not show the hardware warning in a software-only wallet", () => {
    expect(backupFlow(status)).not.toContain("Ledger accounts are not restored");
  });
});
