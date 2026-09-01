/**
 * Shared side-panel view fixtures: the canonical mainnet account, a second
 * account for multi-account layouts, and the default empty preferences used by
 * the sidepanel template suites. Each suite keeps its own WalletStatus (the
 * shape under test) but references these so the account and preference data
 * stay single-sourced.
 */

import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import type { DerivedAccountRef } from "@mc-wallet/wallet-model/accounts";

/**
 * Canonical active mainnet account.
 */
export const account: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

/**
 * A second mainnet account for multi-account layouts.
 */
export const secondAccount: DerivedAccountRef = {
  ...account,
  address: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 1, kind: "starknet-bip44" },
  id: "SN_MAIN:0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
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
