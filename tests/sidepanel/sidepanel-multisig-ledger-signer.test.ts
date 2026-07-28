/**
 * Coverage for surfacing Ledger accounts as multisig signers: the deploy form's
 * signer picker lists this wallet's accounts (Ledger ones badged) with an insert
 * control, and a multisig detail signer row that matches a local Ledger account
 * carries the hardware badge. Confirm/execute for a Ledger signer needs no
 * multisig-specific code — it routes through the shared signerFor branch — so
 * these assert only the net-new picker/badge surface.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { multisigSignersFlow } from "../../src/sidepanel/multisig-management-views";
import { multisigDeployFlow } from "../../src/sidepanel/multisig-views";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";
import type { MultisigRecord } from "../../src/storage/multisig-store";
import type { AccountRef, LedgerAccountRef } from "../../src/storage/vault-schema";
import { account } from "../support/sidepanel-fixtures";

const ledgerSigner: LedgerAccountRef = {
  address: "0x77567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(0),
  },
  id: "SN_MAIN:0x77567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, ledgerSigner] as AccountRef[],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

describe("multisig deploy signer picker", () => {
  test("lists this wallet's accounts with an insert control and badges Ledger ones", () => {
    const html = multisigDeployFlow(status, account, true);
    expect(html).toContain(`data-signer-insert="${account.address}"`);
    expect(html).toContain(`data-signer-insert="${ledgerSigner.address}"`);
    // Exactly one hardware badge in the picker — the Ledger account.
    expect(html.match(/pill-hardware/g)?.length).toBe(1);
  });
});

describe("multisig detail signer badge", () => {
  test("badges a signer that is a local Ledger account", () => {
    const record: MultisigRecord = {
      address: "0x111111111111111111111111111111111111111111111111111111111111111",
      id: "SN_MAIN:0x111111111111111111111111111111111111111111111111111111111111111",
      name: "Treasury",
      networkId: "SN_MAIN",
      quorum: 1,
      signers: [ledgerSigner.address, "0x222"],
    };
    const html = multisigSignersFlow(status, account, record);
    expect(html).toContain("pill-hardware");
    // Only the Ledger signer row carries it, not the plain 0x222 signer.
    expect(html.match(/pill-hardware/g)?.length).toBe(1);
  });
});
