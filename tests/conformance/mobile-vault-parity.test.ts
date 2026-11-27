/**
 * The mobile core adopts the extension's vault schema (v13), pinned by `vault-v13.json`: a vault
 * the extension's own service wrote, at schema 13 (see `scripts/mobile-parity-vault.ts`). This
 * fails when the committed payload is no longer what the extension writes for the same phrase and
 * accounts, or when the committed envelope no longer opens to it: re-run `bun run mobile:parity`.
 * `vault-v13-imported.json` is held to the same rule for the vault with two raw-key imports
 * (wallet-core P3), and the G7b fixtures (`scripts/mobile-parity-vault-full.ts`) for the vault with
 * every collection filled at 13 and 14, and its 13→14 migration.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { migrateVault } from "@bramble/vault/migrations";
import { CURRENT_SCHEMA_VERSION, isVaultV13, isVaultV14 } from "@bramble/vault/schema";
import {
  computeImportedVaultParity,
  computeVaultParity,
  VAULT_IMPORTED_FIXTURE_PATH,
  VAULT_PARITY_FIXTURE_PATH,
  type VaultParity,
} from "../../scripts/mobile-parity-vault";
import {
  computeFullV13VaultParity,
  computeV14VaultParity,
  computeVaultMigrationParity,
  VAULT_FULL_FIXTURE_PATHS,
  type VaultMigrationParity,
} from "../../scripts/mobile-parity-vault-full";

const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("mobile vault parity", () => {
  test("the committed v13 vault is what the extension writes today", async () => {
    const fixture = await read<VaultParity>(VAULT_PARITY_FIXTURE_PATH);
    expect(fixture).toEqual(plain(await computeVaultParity(fixture.sealed)));
    // The extension writes v14; wallet-core still reads v13, so this fixture stays at 13.
    expect(CURRENT_SCHEMA_VERSION).toBe(14);
    expect(isVaultV13(fixture.payload)).toBe(true);
  });

  test("the committed imported-key vault (P3) is what the extension writes today", async () => {
    const fixture = await read<VaultParity>(VAULT_IMPORTED_FIXTURE_PATH);
    expect(fixture).toEqual(plain(await computeImportedVaultParity(fixture.sealed)));
    expect(isVaultV13(fixture.payload)).toBe(true);
  });

  test("the full v13 vault (G7b) fills every collection", async () => {
    const fixture = await read<VaultParity>(VAULT_FULL_FIXTURE_PATHS.v13);
    expect(fixture).toEqual(plain(await computeFullV13VaultParity(fixture.sealed)));
    expect(isVaultV13(fixture.payload)).toBe(true);
    const payload = fixture.payload as Record<string, unknown>;
    for (const [key, value] of Object.entries(payload)) {
      if (Array.isArray(value))
        expect({ key, empty: value.length === 0 }).toEqual({ key, empty: false });
    }
    const kinds = (payload["accounts"] as { derivation: { kind: string; seedId?: string } }[]).map(
      ({ derivation }) => (derivation.seedId ? "imported-phrase" : derivation.kind),
    );
    expect(new Set(kinds)).toEqual(
      new Set(["starknet-bip44", "argentx-bip44", "imported-raw-key", "imported-phrase", "ledger"]),
    );
  });

  test("the full v14 vault (G7b) carries its account provenance", async () => {
    const fixture = await read<VaultParity>(VAULT_FULL_FIXTURE_PATHS.v14);
    expect(fixture).toEqual(plain(await computeV14VaultParity(fixture.sealed)));
    expect(isVaultV14(fixture.payload)).toBe(true);
    const origins = Object.values(
      (fixture.payload as { accountProvenance: Record<string, string> }).accountProvenance,
    );
    expect(new Set(origins)).toEqual(new Set(["created", "imported"]));
  });

  test("the committed 13→14 migration is what the extension's migration does", async () => {
    const fixture = await read<VaultMigrationParity>(VAULT_FULL_FIXTURE_PATHS.migration);
    expect(fixture).toEqual(plain(await computeVaultMigrationParity(fixture)));
    expect(isVaultV13(fixture.input.payload)).toBe(true);
    expect(migrateVault(fixture.input.payload)).toEqual(fixture.output.payload as never);
    expect(fixture.output.payload).not.toHaveProperty("accountProvenance");
  });
});
