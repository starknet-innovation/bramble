/** Recovery requests that must remain inside the encrypted key boundary. */
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import {
  account,
  extensionSender,
  SECRET_MNEMONIC,
  SECRET_PASSPHRASE,
  SECRET_PRIVATE_KEY,
} from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/** Live recovery requests included in the exhaustive background message scan. */
export const RECOVERY_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  {
    message: {
      mnemonic: SECRET_MNEMONIC,
      networkId: "SN_MAIN",
      type: "wallet.discoverRecoveryAccounts",
    },
    sender: extensionSender,
  },
  {
    message: {
      mnemonic: SECRET_MNEMONIC,
      networkId: "SN_MAIN",
      selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
      type: "wallet.recoverAccounts",
      vaultPassphrase: SECRET_PASSPHRASE,
    },
    sender: extensionSender,
  },
  {
    message: {
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      privateKey: SECRET_PRIVATE_KEY,
      type: "wallet.createKeyVault",
      vaultPassphrase: SECRET_PASSPHRASE,
    },
    sender: extensionSender,
  },
  {
    // Ready-key discovery carries the raw key and answers public rows only.
    message: {
      networkId: "SN_MAIN",
      privateKey: SECRET_PRIVATE_KEY,
      type: "wallet.discoverReadyKeyAccounts",
    },
    sender: extensionSender,
  },
  {
    message: {
      mnemonic: SECRET_MNEMONIC,
      networkId: "SN_MAIN",
      selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
      type: "wallet.importSeedAccounts",
    },
    sender: extensionSender,
  },
  {
    // The settings-surface rescan of the wallet's own phrase: no secret in the
    // request, but this handler reaches a vault read, so its response is scanned.
    message: { networkId: "SN_MAIN", type: "wallet.discoverOwnAccounts" },
    sender: extensionSender,
  },
  {
    message: {
      networkId: "SN_MAIN",
      selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
      type: "wallet.importOwnAccounts",
    },
    sender: extensionSender,
  },
  // Import by address (issue 398): the phrase-bearing lookup carries the
  // phrase, and the own-phrase lookup reaches a vault read; both responses are
  // scanned for secret material.
  {
    message: {
      address: account.address,
      mnemonic: SECRET_MNEMONIC,
      networkId: "SN_MAIN",
      type: "wallet.findRecoveryAccountByAddress",
    },
    sender: extensionSender,
  },
  {
    message: {
      address: account.address,
      networkId: "SN_MAIN",
      type: "wallet.findOwnAccountByAddress",
    },
    sender: extensionSender,
  },
  // The private-key variant (issue 779) carries the raw key; its answer is one
  // public row, scanned like every other.
  {
    message: {
      address: account.address,
      networkId: "SN_MAIN",
      privateKey: SECRET_PRIVATE_KEY,
      type: "wallet.findKeyAccountByAddress",
    },
    sender: extensionSender,
  },
  {
    // A Ready key imported by its pasted address (issue 779): re-proved
    // against the chain, then written; the response is scanned all the same.
    message: {
      accountContractType: "argent",
      address: account.address,
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      networkId: "SN_MAIN",
      privateKey: SECRET_PRIVATE_KEY,
      type: "wallet.importAccount",
    },
    sender: extensionSender,
  },
  // Phrase-driven 2FA / guardian removal: reviews and confirmed submissions
  // (live payloads, so the scan reaches the handlers rather than refusals).
  { message: { type: "wallet.reviewArgentRecovery" }, sender: extensionSender },
  { message: { type: "wallet.reviewBraavosRecovery" }, sender: extensionSender },
  {
    message: {
      accountId: account.id,
      replaceEscape: { kind: "owner-escape", readyAt: 1_500 },
      reviewedFee: { overallFee: "1", unit: "FRI" },
      step: "start",
      type: "wallet.recoverArgentAccount",
    },
    sender: extensionSender,
  },
  {
    message: {
      accountId: account.id,
      reviewedFee: { overallFee: "1", unit: "FRI" },
      type: "wallet.recoverBraavosAccount",
    },
    sender: extensionSender,
  },
];
