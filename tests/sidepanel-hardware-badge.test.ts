/**
 * Coverage for the hardware-wallet badge: a Ledger account renders the badge in
 * the account drawer and via the pure helper, while software and imported
 * accounts never do — the badge is a total function of account provenance.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { accountDrawer } from "../src/sidepanel/account-drawer";
import { hardwareBadge } from "../src/sidepanel/parts";
import { ledgerAccountPath } from "../src/starknet/ledger-path";
import type { AccountRef, LedgerAccountRef } from "../src/storage/vault-schema";
import { account, preferences } from "./support/sidepanel-fixtures";

const ledgerAccount: LedgerAccountRef = {
  address: "0x55567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: {
    accountIndex: 1,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(1),
  },
  id: "SN_MAIN:0x55567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

const importedAccount: AccountRef = {
  address: account.address,
  classHash: account.classHash,
  derivation: { kind: "imported-raw-key" },
  id: account.id,
  networkId: "SN_MAIN",
  publicKeyX: account.publicKeyX,
};

describe("hardwareBadge", () => {
  test("renders for a Ledger account and nothing for others", () => {
    expect(hardwareBadge(ledgerAccount)).toContain("Hardware");
    expect(hardwareBadge(account)).toBe("");
    expect(hardwareBadge(importedAccount)).toBe("");
  });
});

describe("accountDrawer badge", () => {
  test("marks a Ledger account row as hardware", () => {
    const status: WalletStatus = {
      accountCount: 2,
      accounts: [account, ledgerAccount],
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      network: "Starknet Mainnet",
      networkId: "SN_MAIN",
      networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
      ready: true,
    };
    const html = accountDrawer(status, account, preferences);
    expect(html).toContain("pill-hardware");
    // Exactly one badge — only the Ledger row carries it.
    expect(html.match(/pill-hardware/g)?.length).toBe(1);
  });
});
