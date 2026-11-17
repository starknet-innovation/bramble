/**
 * The privileged Ledger messages carry an optional EIP-2645 path scheme. Absent
 * means Bramble's own `LedgerW` scheme (every pre-Ready message), `argentx`
 * selects Ready's, and any other marker is refused at the boundary — an unknown
 * application would derive a key no device path this wallet builds can reach.
 */
import { describe, expect, test } from "bun:test";
import {
  readAddLedgerAccountInput,
  readCreateLedgerVaultInput,
  readDeriveLedgerAccountsInput,
} from "../../../apps/extension/src/background/ledger/ledger-inputs";

const PUBLIC_KEY_X = "0x03b1a6dc5a2f9c8e7d4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d";

const add = {
  accountContractType: "argent",
  accountIndex: 12,
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY_X,
  type: "wallet.addLedgerAccount",
};

const create = {
  accountContractType: "argent",
  accountIndex: 12,
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY_X,
  type: "wallet.createLedgerVault",
  vaultPassphrase: "correct horse battery staple",
};

const derive = {
  accountContractType: "argent",
  entries: [{ accountIndex: 12, publicKeyX: PUBLIC_KEY_X }],
  networkId: "SN_MAIN",
  type: "wallet.deriveLedgerAccounts",
};

describe("Ledger message path scheme", () => {
  test("an absent scheme parses without adding a field, so Bramble's default applies", () => {
    expect(readAddLedgerAccountInput(add)).toEqual({
      accountContractType: "argent",
      accountIndex: 12,
      networkId: "SN_MAIN",
      publicKeyX: PUBLIC_KEY_X,
    });
    expect(readCreateLedgerVaultInput(create)).toEqual({
      accountContractType: "argent",
      accountIndex: 12,
      networkId: "SN_MAIN",
      publicKeyX: PUBLIC_KEY_X,
      vaultPassphrase: "correct horse battery staple",
    });
    expect(readDeriveLedgerAccountsInput(derive)).toEqual({
      accountContractType: "argent",
      entries: [{ accountIndex: 12, publicKeyX: PUBLIC_KEY_X }],
      networkId: "SN_MAIN",
    });
  });

  test("Ready's argentx scheme is carried through to the vault input", () => {
    expect(readAddLedgerAccountInput({ ...add, eip2645application: "argentx" })).toMatchObject({
      accountIndex: 12,
      eip2645application: "argentx",
    });
    expect(readCreateLedgerVaultInput({ ...create, eip2645application: "argentx" })).toMatchObject({
      eip2645application: "argentx",
      vaultPassphrase: "correct horse battery staple",
    });
    expect(
      readDeriveLedgerAccountsInput({ ...derive, eip2645application: "argentx" }),
    ).toMatchObject({ eip2645application: "argentx" });
    expect(readAddLedgerAccountInput({ ...add, eip2645application: "LedgerW" })).toMatchObject({
      eip2645application: "LedgerW",
    });
  });

  test("any other marker is refused at the boundary", () => {
    for (const bad of ["ArgentX", "argent", "ledgerw", "", 0, null, {}, ["argentx"]]) {
      expect(readAddLedgerAccountInput({ ...add, eip2645application: bad })).toBeNull();
      expect(readCreateLedgerVaultInput({ ...create, eip2645application: bad })).toBeNull();
      expect(readDeriveLedgerAccountsInput({ ...derive, eip2645application: bad })).toBeNull();
    }
  });
});
