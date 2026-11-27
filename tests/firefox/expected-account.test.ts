/**
 * Pins the browser suites' expected import address to an independent
 * derivation: the vendor-dataset `brambleKeypair` (starknet.js and noble, not
 * Krusty) applied to the public test phrase, at Bramble's OZ 3.0.0 class and
 * salt 0. The Firefox smoke compares what Krusty derived inside Gecko against
 * this literal.
 */
import { describe, expect, test } from "bun:test";
import { hash } from "starknet";
import { brambleKeypair, CLASSES } from "../../tools/vendor-dataset/matrix-lib";
import { EXPECTED_IMPORT_ACCOUNT, IMPORT_MNEMONIC } from "../e2e/test-wallet";

const canonical = (address: string): string => `0x${BigInt(address).toString(16)}`;

describe("expected import account", () => {
  test("index 0 of the test phrase is the OZ 3.0.0 account at salt 0", () => {
    const key = brambleKeypair(IMPORT_MNEMONIC, 0);
    expect(
      canonical(hash.calculateContractAddressFromHash("0x0", CLASSES.oz300, [key.pub], 0)),
    ).toBe(EXPECTED_IMPORT_ACCOUNT);
  });
});
