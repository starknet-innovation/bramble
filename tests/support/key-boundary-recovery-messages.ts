/** Recovery requests that must remain inside the encrypted key boundary. */
import {
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
];
