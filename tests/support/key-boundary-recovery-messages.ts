/** Recovery requests that must remain inside the encrypted key boundary. */
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
  // Phrase-driven 2FA / guardian removal: reviews and confirmed submissions
  // (live payloads, so the scan reaches the handlers rather than refusals).
  { message: { type: "wallet.reviewArgentRecovery" }, sender: extensionSender },
  { message: { type: "wallet.reviewBraavosRecovery" }, sender: extensionSender },
  {
    message: {
      accountId: account.id,
      replaceOwnerEscape: true,
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
