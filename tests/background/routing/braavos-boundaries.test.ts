/**
 * Braavos at the runtime message boundary: a Braavos account can be recovered
 * from a phrase, at the class it was deployed with, and nothing else. Every
 * request that would create one, import one by key, or derive one on a Ledger
 * is malformed, because this wallet never brings a Braavos account into
 * existence and cannot yet authorize for one.
 */
import { describe, expect, test } from "bun:test";
import { BRAAVOS_BASE_CLASS_HASH } from "@bramble/wallet-model/account-families";
import {
  readCreateAccountInput,
  readPreviewAccountInput,
  readRecoverAccountsInput,
} from "../../../apps/extension/src/background/accounts/account-creation-inputs";
import { readImportAccountInput } from "../../../apps/extension/src/background/accounts/import-inputs";
import { readAddLedgerAccountInput } from "../../../apps/extension/src/background/ledger/ledger-inputs";
import { readAddAccountInput } from "../../../apps/extension/src/background/routing/message-inputs";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";

describe("Braavos message boundaries", () => {
  test("recovery accepts a Braavos pick only at a class it names", () => {
    const recovery = {
      mnemonic,
      networkId: "SN_MAIN",
      selections: [
        { accountContractType: "braavos", accountIndex: 1, classHash: BRAAVOS_BASE_CLASS_HASH },
      ],
      type: "wallet.recoverAccounts",
      vaultPassphrase,
    } as const;
    expect(readRecoverAccountsInput(recovery)?.selections).toEqual(recovery.selections);
    expect(
      readRecoverAccountsInput({
        ...recovery,
        selections: [{ accountContractType: "braavos", accountIndex: 1 }],
      }),
    ).toBeNull();
  });

  test("every request that would create or derive a Braavos account is malformed", () => {
    const braavos = { accountContractType: "braavos" } as const;
    expect(
      readAddAccountInput({ ...braavos, networkId: "SN_MAIN", type: "wallet.addAccount" }),
    ).toBeNull();
    expect(
      readCreateAccountInput({
        ...braavos,
        mnemonic,
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readPreviewAccountInput({ ...braavos, mnemonic, type: "wallet.previewAccount" }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        ...braavos,
        networkId: "SN_MAIN",
        privateKey: "0x1234",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readAddLedgerAccountInput({
        ...braavos,
        accountIndex: 0,
        networkId: "SN_MAIN",
        publicKeyX: "0x1234",
        type: "wallet.addLedgerAccount",
      }),
    ).toBeNull();
  });

  test("the same requests pass for a family this wallet creates", () => {
    // Guards the test above: it must fail on the family, not on a malformed fixture.
    const argent = { accountContractType: "argent" } as const;
    expect(
      readAddAccountInput({ ...argent, networkId: "SN_MAIN", type: "wallet.addAccount" }),
    ).not.toBeNull();
    expect(
      readCreateAccountInput({
        ...argent,
        mnemonic,
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).not.toBeNull();
    expect(
      readPreviewAccountInput({ ...argent, mnemonic, type: "wallet.previewAccount" }),
    ).not.toBeNull();
    expect(
      readImportAccountInput({
        ...argent,
        networkId: "SN_MAIN",
        privateKey: "0x1234",
        type: "wallet.importAccount",
      }),
    ).not.toBeNull();
    expect(
      readAddLedgerAccountInput({
        ...argent,
        accountIndex: 0,
        networkId: "SN_MAIN",
        publicKeyX: "0x1234",
        type: "wallet.addLedgerAccount",
      }),
    ).not.toBeNull();
  });
});
