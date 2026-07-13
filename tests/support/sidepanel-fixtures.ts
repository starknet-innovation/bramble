/**
 * Shared side-panel view fixtures: the canonical mainnet account, a second
 * account for multi-account layouts, and the default empty preferences used by
 * the sidepanel template suites. Each suite keeps its own WalletStatus (the
 * shape under test) but references these so the account and preference data
 * stay single-sourced.
 */
import type { WalletPreferences } from "../../src/storage/preferences-store";
import type { AccountRef } from "../../src/storage/vault-schema";

/**
 * Canonical active mainnet account.
 */
export const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

/**
 * A second mainnet account for multi-account layouts.
 */
export const secondAccount: AccountRef = {
  ...account,
  address: "0x9994567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  id: "SN_MAIN:0x9994567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

/**
 * Default empty preferences on mainnet.
 */
export const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};
