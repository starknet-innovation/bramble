/**
 * Approval-card rendering: the activity screen renders an invoke approval with
 * its decoded call summaries and risk flags (A-H1), and a watch-asset approval
 * surfaces phishing insights and disables its Add button when the origin is
 * blocked (A-L1).
 */
import { describe, expect, test } from "bun:test";
import type { PendingApproval, WalletStatus } from "../src/popup/responses";
import { dashboard } from "../src/sidepanel/views";
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

const INVOKE_ID = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
const WATCH_ID = "c92d6ee2-64aa-4c8c-b282-1a1b19f1aa25";

const activity = (pending: readonly PendingApproval[]): string =>
  dashboard("activity", status, pending, preferences, { balances: [] });

describe("invoke approval card (A-H1)", () => {
  const invoke: PendingApproval = {
    flags: [{ code: "unknown-contract", message: "Verify the contract before continuing." }],
    id: INVOKE_ID,
    kind: "invoke",
    origin: "https://dapp.example",
    summaries: ["Send 1000 units to 0x0005…0005"],
  };

  test("renders decoded call summaries, risk flags, and decision buttons", () => {
    const html = activity([invoke]);

    expect(html).toContain("Transaction request");
    expect(html).toContain("https://dapp.example");
    expect(html).toContain("Send 1000 units to 0x0005…0005");
    expect(html).toContain("Verify the contract before continuing.");
    expect(html).toContain(`data-approval-action="approve" data-approval-id="${INVOKE_ID}"`);
    expect(html).toContain(`data-approval-action="deny" data-approval-id="${INVOKE_ID}"`);
  });

  test("disables approve while the wallet is locked", () => {
    const locked = dashboard("activity", { ...status, locked: true }, [invoke], preferences, {
      balances: [],
    });
    expect(locked).toContain(`data-approval-id="${INVOKE_ID}" type="button" disabled`);
  });
});

describe("watch-asset approval card insights (A-L1)", () => {
  test("renders insights and disables Add for a blocked origin", () => {
    const blocked: PendingApproval = {
      blocked: true,
      id: WATCH_ID,
      insights: ["This domain is on the wallet blocklist of known phishing and scam sites."],
      kind: "watch-asset",
      origin: "https://starknet-airdrop.com",
      token: {
        address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
        decimals: 6,
        name: "USD Coin",
        networkId: "SN_MAIN",
        symbol: "USDC",
      },
    };
    const html = activity([blocked]);

    expect(html).toContain("This domain is on the wallet blocklist");
    expect(html).toContain(`data-approval-id="${WATCH_ID}" type="button" disabled`);
  });
});
