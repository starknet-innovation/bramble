/**
 * Pins the Speculos suite's expected addresses to an independent derivation:
 * the vendor-dataset `ledgerKeypair` (the tooling that records TA-32…TA-37),
 * applied to the public test phrase the emulator is seeded with.
 */
import { describe, expect, test } from "bun:test";
import { hash } from "starknet";
import { argentAddress, CLASSES, ledgerKeypair } from "../../../tools/vendor-dataset/matrix-lib";
import { IMPORT_MNEMONIC } from "../wallet-helpers";
import { EXPECTED_LEDGER_ACCOUNTS } from "./expected-accounts";

const canonical = (address: string): string => `0x${BigInt(address).toString(16)}`;

describe("Speculos expected Ledger accounts", () => {
  test("LedgerW index 0 is the TA-32-shaped OZ account", () => {
    const key = ledgerKeypair(IMPORT_MNEMONIC, "ledgerw", 0);
    expect(
      canonical(hash.calculateContractAddressFromHash("0x0", CLASSES.oz300, [key.pub], 0)),
    ).toBe(EXPECTED_LEDGER_ACCOUNTS.ledgerW);
  });

  test("argentx index 0 is the TA-33-shaped Argent 0.4.0 account", () => {
    const key = ledgerKeypair(IMPORT_MNEMONIC, "argentx", 0);
    expect(canonical(argentAddress(key.pub, CLASSES.argent040))).toBe(
      EXPECTED_LEDGER_ACCOUNTS.argentx,
    );
  });

  test("the two schemes give different keys", () => {
    expect(EXPECTED_LEDGER_ACCOUNTS.argentx).not.toBe(EXPECTED_LEDGER_ACCOUNTS.ledgerW);
  });
});
