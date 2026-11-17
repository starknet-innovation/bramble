/**
 * Imported-seed records and their account bindings (schema v8 onward), split
 * from schema.ts on the size budget. Validators only; no record leaves the
 * encrypted vault.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isRecord } from "@bramble/core/json";
import { isAccountRef, isImportedSeedId } from "@bramble/wallet-model/accounts";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";

/**
 * One imported recovery phrase retained beside the founding phrase, inside the
 * encrypted vault only; `id` is the handle HD derivations reference.
 */
export type ImportedSeedRef = {
  readonly id: string;
  readonly mnemonic: string;
};

const isImportedSeedRef = (value: unknown): value is ImportedSeedRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["id", "mnemonic"]) &&
  isImportedSeedId(value["id"]) &&
  isMnemonicText(value["mnemonic"]);

// Every HD account naming a seedId must reference a retained imported seed, so
// a reveal or re-derivation can never dangle (founding-phrase accounts carry
// none — see the VaultV3 mutation-boundary phrase rules).
/**
 * Validates the imported seeds and that every HD account naming a seed id
 * references a retained one.
 */
export const hasValidSeedBindings = (value: Record<string, unknown>): boolean => {
  const seeds = value["importedSeeds"];
  if (!Array.isArray(seeds) || !seeds.every(isImportedSeedRef)) {
    return false;
  }
  if (!hasUniqueStrings(seeds.map((seed) => seed.id))) {
    return false;
  }
  const accounts = value["accounts"];
  return (
    Array.isArray(accounts) &&
    accounts.every((account) => {
      const seedId =
        isAccountRef(account) &&
        (account.derivation.kind === "starknet-bip44" ||
          account.derivation.kind === "argentx-bip44")
          ? account.derivation.seedId
          : undefined;
      return seedId === undefined || seeds.some((seed) => seed.id === seedId);
    })
  );
};
