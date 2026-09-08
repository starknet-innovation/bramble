/** Public account model validation tests. */
import { expect, test } from "bun:test";
import {
  type AccountRef,
  ARGENT_ACCOUNT_CLASS_HASH,
  canonicalAccountId,
  canonicalAccountRef,
  canonicalLegacyAccountRef,
  isAccountId,
  isAccountIdForNetwork,
  isAccountRef,
  isKeylessAccount,
} from "@bramble/wallet-model/accounts";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
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
