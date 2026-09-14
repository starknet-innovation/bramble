/**
 * Coverage for the hardware-wallet badge: a Ledger account renders the badge in
 * the account drawer and via the pure helper, while software and imported
 * accounts never do — the badge is a total function of account provenance.
 */
import { describe, expect, test } from "bun:test";
import { account, preferences } from "@mc-wallet/testkit/sidepanel";
import type { AccountRef, LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { hardwareBadge } from "../../../../src/sidepanel/shared/parts";
import { accountDrawer } from "../../../../src/sidepanel/shell/account-drawer";

const ledgerAccount: LedgerAccountRef = {
  accountContractType: "openzeppelin",
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
  accountContractType: "openzeppelin",
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

  test("keeps the badge outside the name's truncating element", () => {
    const status: WalletStatus = {
      accountCount: 1,
      accounts: [ledgerAccount],
      activeAccountId: ledgerAccount.id,
      hasVault: true,
      locked: false,
      network: "Starknet Mainnet",
      networkId: "SN_MAIN",
      networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
      ready: true,
    };
    const html = accountDrawer(status, ledgerAccount, preferences);
    // `.drawer-copy strong` ellipsises, so a badge inside it is clipped away by
    // any name wide enough to fill the row. It has to be a sibling, inside the
    // flex name line that lets the name shrink instead.
    const name = html.match(/<span class="drawer-name">(.*?)<\/span>\s*<code>/s)?.[1] ?? "";
    expect(name).toContain("pill-hardware");
    expect(name.slice(0, name.indexOf("pill-hardware"))).toContain("</strong>");
  });

  test("escapes status, account labels, and group names before composing drawer markup", () => {
    const unsafe = '<img src=x onerror="steal()">';
    const status: WalletStatus = {
      accountCount: 1,
      accounts: [account],
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      network: unsafe,
      networkId: "SN_MAIN",
      networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
      ready: true,
    };
    const html = accountDrawer(status, account, {
      ...preferences,
      accountLabels: { [account.id]: unsafe },
      groups: [{ accountIds: [account.id], icon: "folder", id: "unsafe", name: unsafe }],
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="');
    expect(html).toContain("&lt;img");
  });
});
