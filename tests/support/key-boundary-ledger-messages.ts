/** Ledger requests that must remain inside the encrypted key boundary. */
import { account, extensionSender, SECRET_PASSPHRASE } from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/** Live Ledger requests included in the exhaustive background message scan. */
export const LEDGER_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  {
    message: {
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: account.publicKeyX,
      type: "wallet.addLedgerAccount",
    },
    sender: extensionSender,
  },
  {
    message: {
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: account.publicKeyX,
      type: "wallet.createLedgerVault",
      vaultPassphrase: SECRET_PASSPHRASE,
    },
    sender: extensionSender,
  },
  {
    message: {
      accountContractType: "openzeppelin",
      entries: [{ accountIndex: 0, publicKeyX: account.publicKeyX }],
      networkId: "SN_MAIN",
      type: "wallet.deriveLedgerAccounts",
    },
    sender: extensionSender,
  },
  {
    message: { address: account.address, networkId: "SN_MAIN", type: "wallet.ledgerAccountStatus" },
    sender: extensionSender,
  },
  { message: { type: "wallet.ledgerSignPending" }, sender: extensionSender },
  {
    message: { type: "wallet.strk20DeriveLedgerViewingKey" },
    negative:
      "a software account must not run the Ledger viewing-key ceremony; its success response is scanned in tests/background/ledger/ledger-viewing-key-ceremony.test.ts",
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: await ids.ledgerSignId() }),
    message: { id: "", r: "0x1", s: "0x2", type: "wallet.completeLedgerSign" },
    sender: extensionSender,
  },
];
