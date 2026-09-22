/**
 * Known-account-type lookups map pinned class hashes to friendly labels and
 * stay felt-based so padding and case never change the result.
 */
import { expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
} from "@bramble/starknet/account-contracts";
import { BRAAVOS_BASE_CLASS_HASH, deploymentClasses } from "@bramble/wallet-model/account-families";
import { knownAccountType } from "@bramble/wallet-ui/lab";

const OZ_CLASS_HASH = "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";

test("labels the OpenZeppelin AccountUpgradeable class hash", () => {
  expect(knownAccountType(OZ_CLASS_HASH)).toBe("Bramble Account (OpenZeppelin AccountUpgradeable)");
});

test("labels the OZ hash regardless of leading-zero padding or case", () => {
  expect(
    knownAccountType("0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"),
  ).toBe("Bramble Account (OpenZeppelin AccountUpgradeable)");
  expect(knownAccountType(OZ_CLASS_HASH.toUpperCase().replace("0X", "0x"))).toBe(
    "Bramble Account (OpenZeppelin AccountUpgradeable)",
  );
});

test("labels the pinned Argent account classes", () => {
  expect(knownAccountType(ARGENT_ACCOUNT_CONTRACT.classHash)).toBe("Ready Account (Argent)");
  expect(knownAccountType(ARGENT_MULTISIG_CONTRACT.classHash)).toBe("Ready Multisig (Argent)");
});

test("labels every class a restored account can be deployed with", () => {
  // A restored account stores the class that fixed its address, which may be
  // an earlier Argent release or a Braavos class.
  for (const entry of deploymentClasses()) {
    expect(knownAccountType(entry.classHash), entry.label).not.toBeNull();
  }
  const earlier = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.0");
  expect(knownAccountType(earlier?.classHash ?? "")).toBe("Ready Account (Argent 0.3.0)");
  expect(knownAccountType(BRAAVOS_BASE_CLASS_HASH)).toBe("Braavos Account");
});

test("returns null for an unknown class hash", () => {
  expect(knownAccountType("0xdeadbeef")).toBeNull();
});

test("returns null for an unparseable hash", () => {
  expect(knownAccountType("not-a-hash")).toBeNull();
});
