/** Privileged Ledger enumeration input stays bounded to one UI page. */
import { expect, test } from "bun:test";
import { MAX_LEDGER_ACCOUNT_BATCH } from "@bramble/wallet-model/ledger-path";
import { readDeriveLedgerAccountsInput } from "../../../apps/extension/src/background/ledger/ledger-inputs";

test("rejects Ledger enumeration batches larger than the shared page bound", () => {
  const entries = Array.from({ length: MAX_LEDGER_ACCOUNT_BATCH + 1 }, (_, accountIndex) => ({
    accountIndex,
    publicKeyX: `0x${accountIndex + 1}`,
  }));
  expect(
    readDeriveLedgerAccountsInput({
      entries,
      networkId: "SN_MAIN",
      type: "wallet.deriveLedgerAccounts",
    }),
  ).toBeNull();
});
