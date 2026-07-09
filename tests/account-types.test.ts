/**
 * Known-account-type lookups map pinned class hashes to friendly labels and
 * stay felt-based so padding and case never change the result.
 */
import { expect, test } from "bun:test";

import { knownAccountType } from "../src/starknet/account-types";
import { MULTISIG_CLASS_HASH } from "../src/starknet/multisig-deploy";

const OZ_CLASS_HASH = "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";

test("labels the OpenZeppelin AccountUpgradeable class hash", () => {
  expect(knownAccountType(OZ_CLASS_HASH)).toBe("OpenZeppelin (AccountUpgradeable)");
});

test("labels the OZ hash regardless of leading-zero padding or case", () => {
  expect(
    knownAccountType("0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"),
  ).toBe("OpenZeppelin (AccountUpgradeable)");
  expect(knownAccountType(OZ_CLASS_HASH.toUpperCase().replace("0X", "0x"))).toBe(
    "OpenZeppelin (AccountUpgradeable)",
  );
});

test("labels the Starknet multisig class hash", () => {
  expect(knownAccountType(MULTISIG_CLASS_HASH)).toBe("Starknet multisig");
});

test("returns null for an unknown class hash", () => {
  expect(knownAccountType("0xdeadbeef")).toBeNull();
});

test("returns null for an unparseable hash", () => {
  expect(knownAccountType("not-a-hash")).toBeNull();
});
