/**
 * Template checks for the allowance manager, NFT gallery, and the pending
 * transaction speed-up/cancel info affordance.
 */
import { describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@mc-wallet/portfolio/nft-metadata";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { account, preferences } from "@mc-wallet/testkit/sidepanel";
import type { AllowanceView } from "@mc-wallet/transactions/allowance-discovery";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";

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

const allowance: AllowanceView = {
  accountId: account.id,
  amount: "1000",
  id: "SN_MAIN:0x49d3657:0x5abcdef1234",
  networkId: "SN_MAIN",
  source: "wallet",
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
      owner: account.address,
      tokenId: "5",
    },
    {
      contract: "0x6220000",
      id: "SN_MAIN:0x6220000:9",
      networkId: "SN_MAIN",
      owner: account.address,
      spam: true,
      tokenId: "9",
    },
  ],
};

const ownedNft: DiscoveredNft = {
  collection: "",
  contract: "0x511a2b3",
  id: "SN_MAIN:0x511a2b3:5",
  image: "",
  name: "Punk",
  networkId: "SN_MAIN",
  tokenId: "5",
};

const dashboardWithNft = (
  view: "nft-detail" | "nft-hidden" | "nft-send" | "nfts",
  selectedNftId: string | null = null,
): string =>
  dashboard(
    view,
    status,
    [],
    nftPrefs,
    { balances: [] },
    null,
    [],
    [],
    {},
    [],
    null,
    [],
    selectedNftId,
    {},
    [],
    [],
    null,
    null,
    null,
    null,
    false,
    null,
    [ownedNft],
  );

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
  test("pending transactions explain immediate refresh and protocol limits", () => {
    const html = dashboard("activity", status, [], preferences, { balances: [] }, null, [
      pendingTx,
    ]);
    expect(html).toContain("normally confirms quickly");
    expect(html).toContain("checks immediately");
    expect(html).toContain("fee-bumped, replaced, or cancelled");
    expect(html).toMatch(/tx-status pending"[^>]*title="/);

    const settled = dashboard("activity", status, [], preferences, { balances: [] }, null, [
      { ...pendingTx, status: "accepted" as const },
    ]);
    expect(settled).not.toContain("fee-bumped, replaced, or cancelled");
  });

  test("home links to the NFT gallery and settings links to allowances", () => {
    const home = dashboard("home", status, [], preferences, { balances: [] });
    expect(home).toContain('data-view="nfts"');
    const settings = dashboard("settings", status, [], preferences, { balances: [] });
    expect(settings).toContain('data-view="security"');
    const security = dashboard("security", status, [], preferences, { balances: [] });
    expect(security).toContain('data-view="allowances"');
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
      [],
      {},
      [],
      null,
      [allowance],
    );
    expect(html).toContain('data-revoke-allowance="SN_MAIN:0x49d3657:0x5abcdef1234"');
    expect(html).toContain("Revoke");
    // Amounts render through the shared display policy (grouped thousands).
    expect(html).toContain("1,000");
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
  });

  test("NFT gallery grids visible NFTs and routes watch and hidden management", () => {
    const html = dashboardWithNft("nfts");
    expect(html).toContain('data-nft-open="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain("Punk");
    expect(html).toContain('data-view="nft-watch"');
    expect(html).toContain('data-nft-spam="SN_MAIN:0x511a2b3:5"');
    expect(html).toContain('data-view="nft-hidden"');
    const hidden = dashboardWithNft("nft-hidden");
    expect(hidden).toContain('data-nft-spam-value="false"');
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
  });

  test("NFT detail shows identifiers and routes to a focused send flow", () => {
    const html = dashboardWithNft("nft-detail", ownedNft.id);
    expect(html).toContain('data-view="nft-send"');
    expect(html).toContain("0x511a…a2b3");
    expect(html).toMatch(/data-nav-back[^>]*aria-label="Back"/);
    const send = dashboardWithNft("nft-send", ownedNft.id);
    expect(send).toContain('id="nft-send-form"');

    const missing = dashboardWithNft("nft-detail", "x");
    expect(missing).toContain("no longer watched");
  });
});
