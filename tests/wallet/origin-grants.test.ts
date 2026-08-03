/**
 * Origin-grant policy checks: a stored grant only exposes accounts while the
 * wallet's active account is one of them, and it always leads the list. These
 * pin the pure rule behind `getGrantedAccounts` without touching storage.
 */
import { describe, expect, test } from "bun:test";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";
import { connectedSitesFromVault, grantedAccountIdsFor } from "../../src/wallet/origin-grants";

const ORIGIN = "https://example.com";

const accountAt = (suffix: string): AccountRef => ({
  address: `0x${suffix}`,
  classHash: "0xabcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:0x${suffix}`,
  networkId: "SN_MAIN",
  publicKeyX: `0xpub${suffix}`,
  publicKeyY: "0xdef",
});

const first = accountAt("a1");
const second = accountAt("b2");
const third = accountAt("c3");

const vaultWith = (
  activeAccountId: string | null,
  accountIds: readonly string[] | null,
): Vault => ({
  accounts: [first, second, third],
  activeAccountId,
  mnemonic: null,
  originGrants: accountIds === null ? [] : [{ accountIds, origin: ORIGIN }],
  schemaVersion: 3,
  signingKeys: [],
});

describe("grantedAccountIdsFor", () => {
  test("returns nothing for an origin with no grant", () => {
    expect(grantedAccountIdsFor(vaultWith(first.id, null), ORIGIN)).toEqual([]);
    expect(grantedAccountIdsFor(vaultWith(first.id, [first.id]), "https://other.example")).toEqual(
      [],
    );
  });

  test("exposes a single-account grant only while that account is active", () => {
    expect(grantedAccountIdsFor(vaultWith(first.id, [first.id]), ORIGIN)).toEqual([first.id]);
    expect(grantedAccountIdsFor(vaultWith(second.id, [first.id]), ORIGIN)).toEqual([]);
  });

  test("puts the active account first in a multi-account grant", () => {
    const granted = [first.id, second.id, third.id];

    expect(grantedAccountIdsFor(vaultWith(first.id, granted), ORIGIN)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(grantedAccountIdsFor(vaultWith(third.id, granted), ORIGIN)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });

  test("hides a grant whose accounts exclude the active account", () => {
    expect(grantedAccountIdsFor(vaultWith(third.id, [first.id, second.id]), ORIGIN)).toEqual([]);
  });

  test("hides every grant when no account is selected", () => {
    expect(grantedAccountIdsFor(vaultWith(null, [first.id, second.id]), ORIGIN)).toEqual([]);
  });
});

describe("connectedSitesFromVault", () => {
  test("lists every stored grant regardless of which account is active", () => {
    const vault: Vault = {
      ...vaultWith(third.id, [first.id, second.id]),
      originGrants: [
        { accountIds: [first.id, second.id], origin: "https://zeta.example" },
        { accountIds: [first.id], origin: "https://alpha.example" },
      ],
    };

    expect(connectedSitesFromVault(vault)).toEqual([
      { accountCount: 1, origin: "https://alpha.example" },
      { accountCount: 2, origin: "https://zeta.example" },
    ]);
  });
});
