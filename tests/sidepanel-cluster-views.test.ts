/**
 * Template checks for the allowance manager, NFT gallery, and the pending
 * transaction speed-up/cancel info affordance.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { dashboard } from "../src/sidepanel/views";
import type { AllowanceRecord } from "../src/storage/allowance-store";
import type { WalletPreferences } from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

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

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};

const allowance: AllowanceRecord = {
  accountId: account.id,
  amount: "1000",
  id: "SN_MAIN:0x49d3657:0x5abcdef1234",
  networkId: "SN_MAIN",
  spender: "0x5abcdef1234",
  token: "0x49d3657",
};

const nftPrefs: WalletPreferences = {
  ...preferences,
  nfts: [
    {
      contract: "0x511a2b3",
      id: "SN_MAIN:0x511a2b3:5",
      label: "Punk",
      networkId: "SN_MAIN",
      tokenId: "5",
    },
    {
      contract: "0x6220000",
      id: "SN_MAIN:0x6220000:9",
      networkId: "SN_MAIN",
      spam: true,
      tokenId: "9",
    },
  ],
};

const pendingTx = {
  accountId: account.id,
  hash: "0x7abc1234567890abcdef",
  kind: "transfer" as const,
  networkId: "SN_MAIN" as const,
  status: "pending" as const,
  submittedAt: 1000,
  summary: "Send 1 ETH",
};

describe("cluster views", () => {
  test("pending transactions explain they cannot be sped up or cancelled", () => {
    const html = dashboard("activity", status, [], preferences, { balances: [] }, null, [
      pendingTx,
    ]);
    expect(html).toContain("cannot be sped up or cancelled");
    expect(html).toMatch(/tx-status pending"[^>]*title="/);

    const settled = dashboard("activity", status, [], preferences, { balances: [] }, null, [
      { ...pendingTx, status: "accepted" as const },
    ]);
    expect(settled).not.toContain("cannot be sped up or cancelled");
  });

  test("home links to the NFT gallery and settings links to allowances", () => {
    const home = dashboard("home", status, [], preferences, { balances: [] });
    expect(home).toContain('data-view="nfts"');
    const settings = dashboard("settings", status, [], preferences, { balances: [] });
    expect(settings).toContain('data-view="allowances"');
  });

  test("allowance flow lists tracked approvals with a revoke control", () => {
    const html = dashboard(
      "allowances",
      status,
      [],
      preferences,
      { balances: [] },
      null,
      [],
      [allowance],
    );
    expect(html).toContain('data-revoke-allowance="SN_MAIN:0x49d3657:0x5abcdef1234"');
    expect(html).toContain("Revoke");
    expect(html).toContain("1000");
    expect(html).toMatch(/data-view="settings"[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
  });

  test("NFT gallery grids visible NFTs, hides spam, and offers an add form", () => {
    const html = dashboard("nfts", status, [], nftPrefs, { balances: [] });
    expect(html).toContain('data-nft-open="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain("Punk");
    expect(html).toContain('id="nft-form"');
    expect(html).toContain('data-nft-spam="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain("Hidden");
    expect(html).toContain('data-nft-spam-value="false"');
    expect(html).toMatch(/data-view="home"[^>]*aria-label="Back"/);
  });

  test("NFT detail shows identifiers and a send form for the selection", () => {
    const html = dashboard(
      "nft-detail",
      status,
      [],
      nftPrefs,
      { balances: [] },
      null,
      [],
      [],
      "SN_MAIN:0x511a2b3:5",
    );
    expect(html).toContain('id="nft-send-form"');
    expect(html).toContain("0x511a2b3");
    expect(html).toMatch(/data-view="nfts"[^>]*aria-label="Back"/);

    const missing = dashboard(
      "nft-detail",
      status,
      [],
      nftPrefs,
      { balances: [] },
      null,
      [],
      [],
      "x",
    );
    expect(missing).toContain("no longer watched");
  });
});
