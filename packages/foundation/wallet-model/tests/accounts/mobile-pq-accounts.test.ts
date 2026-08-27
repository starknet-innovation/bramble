/**
 * A paired-phone account is keyless but is not a Ledger, and its record is the
 * first one whose public key does not fit in a felt. These tests pin both: the
 * exact record shape accepted off storage or an untrusted message, and the two
 * predicates that decide which signing backend a submit will reach.
 */
import { expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  canonicalAccountRef,
  isAccountRef,
  isKeylessAccount,
  isLedgerAccount,
} from "@mc-wallet/wallet-model/accounts";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import { canonicalFelt } from "@mc-wallet/wallet-model/networks";
import { isMlDsa65PublicKey, ML_DSA_65_PUBLIC_KEY_BYTES } from "@mc-wallet/wallet-model/signing";

const publicKey = `0x${"ab".repeat(ML_DSA_65_PUBLIC_KEY_BYTES)}`;

const mobile = {
  accountContractType: "ml-dsa" as const,
  mlDsaKind: "const" as const,
  address: "0xdef",
  classHash: "0xabc",
  derivation: {
    deviceId: "phone-1",
    kind: "mobile-pq" as const,
    transport: { kind: "clipboard" as const },
  },
  id: "SN_MAIN:0xdef",
  networkId: "SN_MAIN" as const,
  publicKey,
  publicKeyX: "0x456",
};

const ledger = {
  accountContractType: "openzeppelin" as const,
  address: "0xdef",
  classHash: "0xabc",
  derivation: {
    accountIndex: 2,
    eip2645application: LEDGER_EIP2645_APPLICATION,
    kind: "ledger" as const,
    path: ledgerAccountPath(2),
  },
  id: "SN_MAIN:0xdef",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x456",
};

test("a paired-phone record round-trips and keeps its full public key", () => {
  expect(isAccountRef(mobile)).toBe(true);
  expect(canonicalAccountRef({ ...mobile, address: "0x0def", id: "SN_MAIN:0x0def" })).toEqual(
    mobile,
  );
});

test("the record is rejected without a well-formed enclave public key", () => {
  const { publicKey: _omitted, ...withoutKey } = mobile;
  expect(isAccountRef(withoutKey)).toBe(false);
  expect(isAccountRef({ ...mobile, publicKey: "0x456" })).toBe(false);
  expect(isAccountRef({ ...mobile, publicKey: `${publicKey}ab` })).toBe(false);
  expect(isAccountRef({ ...mobile, publicKey: publicKey.toUpperCase() })).toBe(false);
  // A Ledger record may not smuggle one in, and this one may not omit it.
  expect(isAccountRef({ ...ledger, publicKey })).toBe(false);
});

test("an unreachable transport or unbounded device id is refused", () => {
  const derivation = mobile.derivation;
  expect(isAccountRef({ ...mobile, derivation: { ...derivation, deviceId: "" } })).toBe(false);
  expect(isAccountRef({ ...mobile, derivation: { ...derivation, deviceId: "d".repeat(65) } })).toBe(
    false,
  );
  expect(
    isAccountRef({ ...mobile, derivation: { ...derivation, transport: { kind: "relay" } } }),
  ).toBe(false);
  expect(isAccountRef({ ...mobile, derivation: { deviceId: "d", kind: "mobile-pq" } })).toBe(false);
});

test("a paired phone must be an ml-dsa account and nothing else", () => {
  // Argent and OpenZeppelin both validate Stark ECDSA on chain, which a phone
  // holding an ML-DSA key cannot produce. Argent is the dangerous one: the fee
  // estimator simulates its accounts with validation enabled, which here would
  // verify 107 felts of dummy input and fail every review.
  expect(isAccountRef({ ...mobile, accountContractType: "openzeppelin" })).toBe(false);
  expect(isAccountRef({ ...mobile, accountContractType: "argent" })).toBe(false);
  expect(
    isAccountRef({
      ...mobile,
      accountContractType: "argent",
      classHash: canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string,
      deploymentSalt: "0x77",
    }),
  ).toBe(false);
  // And it stores no deployment salt: only Argent derives an address from one.
  expect(isAccountRef({ ...mobile, deploymentSalt: "0x77" })).toBe(false);
});

test("the contract family and the derivation must agree in both directions", () => {
  // The dangerous direction is this one. An ml-dsa contract with a vault-keyed
  // derivation is a record that HAS a signing key, so the seam routes it to the
  // vault and it produces a Stark signature its own contract would reject — a
  // bricked account, shown to the user as post-quantum. It must not validate.
  const { derivation: _mobile, publicKey: _key, ...core } = mobile;
  expect(
    isAccountRef({
      ...core,
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
      publicKeyY: "0x789",
    }),
  ).toBe(false);
  expect(isAccountRef({ ...core, derivation: { kind: "imported-raw-key" } })).toBe(false);
  expect(isAccountRef({ ...core, derivation: ledger.derivation })).toBe(false);
  // Adding the enclave key back does not rescue any of them.
  expect(isAccountRef({ ...core, derivation: { kind: "imported-raw-key" }, publicKey })).toBe(
    false,
  );
});

test("keyless covers both devices but only one of them is a Ledger", () => {
  expect(isKeylessAccount(mobile)).toBe(true);
  expect(isLedgerAccount(mobile)).toBe(false);
  expect(isKeylessAccount(ledger)).toBe(true);
  expect(isLedgerAccount(ledger)).toBe(true);
});

test("the public-key check is exact on length and lowercase", () => {
  expect(isMlDsa65PublicKey(publicKey)).toBe(true);
  expect(isMlDsa65PublicKey(publicKey.slice(0, -2))).toBe(false);
  expect(isMlDsa65PublicKey(`0x${"ab".repeat(ML_DSA_65_PUBLIC_KEY_BYTES - 1)}`)).toBe(false);
  expect(isMlDsa65PublicKey(publicKey.replace("ab", "AB"))).toBe(false);
  expect(isMlDsa65PublicKey(undefined)).toBe(false);
});
