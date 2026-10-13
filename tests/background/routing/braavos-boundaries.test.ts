/**
 * Braavos at the runtime message boundary: a Braavos account can be recovered
 * from a phrase (at the class it names) or owned by a Ledger key (Braavos
 * derives it at Ready's `argentx` scheme), but this wallet never creates one
 * from scratch or imports one by raw key. So a create, add, preview, or
 * raw-key-import request naming Braavos is malformed, while a Ledger request
 * naming Braavos is valid.
 */
import { describe, expect, test } from "bun:test";
import { BRAAVOS_BASE_CLASS_HASH } from "@bramble/wallet-model/account-families";
import {
  readCreateAccountInput,
  readPreviewAccountInput,
  readRecoverAccountsInput,
} from "../../../apps/extension/src/background/accounts/account-creation-inputs";
import { readImportAccountInput } from "../../../apps/extension/src/background/accounts/import-inputs";
import {
  readAddLedgerAccountInput,
  readCreateLedgerVaultInput,
  readDeriveLedgerAccountsInput,
} from "../../../apps/extension/src/background/ledger/ledger-inputs";
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

  test("a create, add, preview, or raw-key import naming Braavos is malformed", () => {
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
  });

  test("a Braavos account can be owned by a Ledger key", () => {
    // A Braavos account whose owner is a Ledger stark key is restored, never
    // created: Braavos derives it at Ready's `argentx` scheme, so every Ledger
    // request naming Braavos is valid at this boundary.
    const braavos = { accountContractType: "braavos", eip2645application: "argentx" } as const;
    expect(
      readAddLedgerAccountInput({
        ...braavos,
        accountIndex: 0,
        networkId: "SN_MAIN",
        publicKeyX: "0x1234",
        type: "wallet.addLedgerAccount",
      }),
    ).not.toBeNull();
    expect(
      readDeriveLedgerAccountsInput({
        ...braavos,
        entries: [{ accountIndex: 0, publicKeyX: "0x1234" }],
        networkId: "SN_MAIN",
        type: "wallet.deriveLedgerAccounts",
      }),
    ).not.toBeNull();
    expect(
      readCreateLedgerVaultInput({
        ...braavos,
        accountIndex: 0,
        networkId: "SN_MAIN",
        publicKeyX: "0x1234",
        type: "wallet.createLedgerVault",
        vaultPassphrase,
      }),
    ).not.toBeNull();
  });

  test("a Ledger Braavos request at any scheme but argentx is refused", () => {
    // Braavos derives its Ledger key only at the \`argentx\` scheme, so a request
    // naming Braavos at Bramble's LedgerW scheme (explicit, or absent) would
    // store an address no Braavos account of this device can have.
    for (const scheme of [{ eip2645application: "LedgerW" }, {}] as const) {
      const braavos = { accountContractType: "braavos", ...scheme } as const;
      expect(
        readAddLedgerAccountInput({
          ...braavos,
          accountIndex: 0,
          networkId: "SN_MAIN",
          publicKeyX: "0x1234",
          type: "wallet.addLedgerAccount",
        }),
      ).toBeNull();
      expect(
        readDeriveLedgerAccountsInput({
          ...braavos,
          entries: [{ accountIndex: 0, publicKeyX: "0x1234" }],
          networkId: "SN_MAIN",
          type: "wallet.deriveLedgerAccounts",
        }),
      ).toBeNull();
      expect(
        readCreateLedgerVaultInput({
          ...braavos,
          accountIndex: 0,
          networkId: "SN_MAIN",
          publicKeyX: "0x1234",
          type: "wallet.createLedgerVault",
          vaultPassphrase,
        }),
      ).toBeNull();
    }
  });

  test("the same requests pass for a family this wallet creates", () => {
    // Guards the malformed-request test above: it must fail on the family, not
    // on a malformed fixture.
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
