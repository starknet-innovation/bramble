/**
 * Known-account-type lookups map pinned class hashes to friendly labels and
 * stay felt-based so padding and case never change the result.
 */
import { expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
} from "@mc-wallet/starknet/account-contracts";
import { knownAccountType } from "@mc-wallet/wallet-ui/lab";

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

test("labels the pinned Argent account classes", () => {
  expect(knownAccountType(ARGENT_ACCOUNT_CONTRACT.classHash)).toBe("Argent Account");
  expect(knownAccountType(ARGENT_MULTISIG_CONTRACT.classHash)).toBe("Argent Multisig");
});

test("returns null for an unknown class hash", () => {
  expect(knownAccountType("0xdeadbeef")).toBeNull();
});

test("returns null for an unparseable hash", () => {
  expect(knownAccountType("not-a-hash")).toBeNull();
});
