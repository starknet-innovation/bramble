/** Public account model validation tests. */
import { expect, test } from "bun:test";
import { BRAAVOS_BASE_CLASS_HASH } from "@bramble/wallet-model/account-families";
import {
  type AccountRef,
  ARGENT_ACCOUNT_CLASS_HASH,
  accountContractFields,
  canonicalAccountId,
  canonicalAccountRef,
  canonicalLegacyAccountRef,
  isAccountId,
  isAccountIdForNetwork,
  isAccountRef,
  isKeylessAccount,
  isLegacyV10AccountRef,
  isRecoverableAccountRef,
  recoveryLadderIndex,
} from "@bramble/wallet-model/accounts";
import {
  LEDGER_EIP2645_APPLICATION,
  ledgerAccountPath,
  READY_EIP2645_APPLICATION,
} from "@bramble/wallet-model/ledger-path";
import { canonicalFelt } from "@bramble/wallet-model/networks";

const argentClassHash = canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string;

const derived = {
  accountContractType: "openzeppelin" as const,
  address: "0x123",
  classHash: "0xabc",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x456",
  publicKeyY: "0x789",
};

test("account identity, network scope, and Ledger provenance fail closed", () => {
  const ledger = {
    accountContractType: "argent" as const,
    address: "0xdef",
    classHash: argentClassHash,
    deploymentSalt: "0x77",
    derivation: {
      accountIndex: 2,
      eip2645application: LEDGER_EIP2645_APPLICATION,
      kind: "ledger" as const,
      path: ledgerAccountPath(2),
    },
    id: "SN_MAIN:0xdef",
    networkId: "SN_MAIN",
    publicKeyX: "0x456",
  };

  expect(isAccountRef(derived)).toBe(true);
  expect(isAccountId(derived.id)).toBe(true);
  // Non-strings canonicalise to null and must never compare equal to it.
  for (const notAnId of [null, undefined, 42, {}, [], derived.id.toUpperCase()]) {
    expect(isAccountId(notAnId), String(notAnId)).toBe(false);
  }
  expect(isAccountIdForNetwork(derived.id, derived.networkId)).toBe(true);
  expect(isAccountIdForNetwork(derived.id, "SN_SEPOLIA")).toBe(false);
  expect(isAccountId("SN_MAIN:0x0123")).toBe(false);
  expect(canonicalAccountId("SN_MAIN:0x0123")).toBe("SN_MAIN:0x123");
  expect(
    canonicalAccountRef({ ...derived, address: "0x0123", id: "SN_MAIN:0x0123" }),
  ).toMatchObject(derived);
  expect(isAccountRef(ledger)).toBe(true);
  expect(isKeylessAccount(ledger as AccountRef)).toBe(true);
  expect(isAccountRef({ ...derived, id: "SN_SEPOLIA:0x123" })).toBe(false);
  expect(
    isAccountRef({ ...ledger, derivation: { ...ledger.derivation, path: ledgerAccountPath(3) } }),
  ).toBe(false);
});

test("a Ledger account restored from Ready carries its own scheme, marker and path agreeing", () => {
  const ready = {
    accountContractType: "argent" as const,
    address: "0xdef",
    classHash: argentClassHash,
    deploymentSalt: "0x456",
    derivation: {
      accountIndex: 12,
      eip2645application: READY_EIP2645_APPLICATION,
      kind: "ledger" as const,
      path: ledgerAccountPath(12, READY_EIP2645_APPLICATION),
    },
    id: "SN_MAIN:0xdef",
    networkId: "SN_MAIN",
    publicKeyX: "0x456",
  };
  expect(isAccountRef(ready)).toBe(true);
  expect(isKeylessAccount(ready as AccountRef)).toBe(true);
  // A marker over the other scheme's path would sign with a key the picker
  // never enumerated: every cross-scheme combination fails closed.
  expect(
    isAccountRef({ ...ready, derivation: { ...ready.derivation, path: ledgerAccountPath(12) } }),
  ).toBe(false);
  expect(
    isAccountRef({
      ...ready,
      derivation: { ...ready.derivation, eip2645application: LEDGER_EIP2645_APPLICATION },
    }),
  ).toBe(false);
  expect(
    isAccountRef({
      ...ready,
      derivation: { ...ready.derivation, path: ledgerAccountPath(11, READY_EIP2645_APPLICATION) },
    }),
  ).toBe(false);
  expect(
    isAccountRef({ ...ready, derivation: { ...ready.derivation, eip2645application: "ArgentX" } }),
  ).toBe(false);
});

test("ordinary account contract semantics are explicit", () => {
  expect(isAccountRef({ ...derived, accountContractType: undefined })).toBe(false);
  const argent = {
    ...derived,
    accountContractType: "argent" as const,
    classHash: argentClassHash,
    deploymentSalt: "0x456",
  };
  expect(isAccountRef(argent)).toBe(true);
  expect(isAccountRef({ ...argent, classHash: "0x123" })).toBe(false);
  expect(isAccountRef({ ...derived, accountContractType: "argent" })).toBe(false);
  expect(isAccountRef({ ...derived, deploymentSalt: "0x456" })).toBe(false);
  expect(isAccountRef({ ...derived, accountContractType: "argent-multisig" })).toBe(false);
  const { accountContractType: _, ...legacy } = derived;
  expect(canonicalLegacyAccountRef(legacy)).toEqual(legacy);
});

test("a Braavos record keeps its family and salt through canonicalization", () => {
  // A branch that knew only Argent once turned every other salted family into
  // OpenZeppelin here, dropping the salt the address derives from.
  const braavos = {
    ...derived,
    accountContractType: "braavos" as const,
    classHash: BRAAVOS_BASE_CLASS_HASH,
    deploymentSalt: "0x0456",
  };
  expect(canonicalAccountRef(braavos)).toMatchObject({
    accountContractType: "braavos",
    deploymentSalt: "0x456",
  });
  // Stored records are canonical: the padded salt is refused, the canonical one kept.
  expect(isAccountRef(braavos)).toBe(false);
  expect(isAccountRef({ ...braavos, deploymentSalt: "0x456" })).toBe(true);
  const { deploymentSalt: _salt, ...unsalted } = braavos;
  expect(canonicalAccountRef(unsalted)).toBeNull();
});

test("record contract fields keep a salt for every family whose address uses one", () => {
  expect(accountContractFields("openzeppelin", undefined)).toEqual({
    accountContractType: "openzeppelin",
  });
  expect(accountContractFields("openzeppelin", "0x1")).toEqual({
    accountContractType: "openzeppelin",
  });
  expect(accountContractFields("argent", "0x1")).toEqual({
    accountContractType: "argent",
    deploymentSalt: "0x1",
  });
  expect(accountContractFields("braavos", "0x1")).toEqual({
    accountContractType: "braavos",
    deploymentSalt: "0x1",
  });
  expect(accountContractFields("argent", undefined)).toBeNull();
  expect(accountContractFields("braavos", undefined)).toBeNull();
});

test("a Ready-scheme account record is x-only and schema-gated (issue 505)", () => {
  const argentx = {
    accountContractType: "argent" as const,
    address: "0x123",
    classHash: argentClassHash,
    deploymentSalt: "0x456",
    derivation: { addressIndex: 4, kind: "argentx-bip44" as const },
    id: "SN_MAIN:0x123",
    networkId: "SN_MAIN" as const,
    publicKeyX: "0x456",
  };
  expect(isAccountRef(argentx)).toBe(true);
  expect(isRecoverableAccountRef(argentx)).toBe(true);
  // The scheme yields no Y coordinate, so carrying one is a forgery.
  expect(isAccountRef({ ...argentx, publicKeyY: "0x789" })).toBe(false);
  // And the wallet's own kind still requires it.
  expect(isAccountRef({ ...derived, publicKeyY: undefined })).toBe(false);
  // An account-axis field on the Ready scheme is not a coordinate it has.
  expect(isAccountRef({ ...argentx, derivation: { ...argentx.derivation, accountIndex: 0 } })).toBe(
    false,
  );
  // No v10 writer produced the kind: the v10 validator must refuse it.
  expect(isLegacyV10AccountRef(argentx)).toBe(false);
  expect(isLegacyV10AccountRef(derived)).toBe(true);
  // One ladder position per candidate, whichever axis the scheme walks.
  expect(recoveryLadderIndex(argentx)).toBe(4);
  expect(recoveryLadderIndex(derived)).toBe(0);
  expect(
    recoveryLadderIndex({
      ...derived,
      derivation: { ...derived.derivation, addressIndex: 7 },
    }),
  ).toBe(7);
});
