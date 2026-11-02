/**
 * Where the Sepolia dataset seeds and keys (issue 821) live: the git-ignored
 * seed file (see dataset-env), one variable per seed or key, shared through
 * the password manager like the mainnet seeds. Never committed: the set may
 * grow to hold mainnet keys. Callers name a seed by its scope-doc id; nothing
 * here logs or returns more than the one value asked for.
 */
import { envSeed } from "./dataset-env";

// Scope-doc id → seed-file variable.
const SEPOLIA_SECRETS = {
  // Bramble ladder: TA-01 (the bank and deployer) and the TA-02…TA-08 rows.
  "S-BRM": "BRAMBLE_DATASET_SEED_S_BRM",
} as const;

export type SepoliaSecret = keyof typeof SEPOLIA_SECRETS;

/** The seed-file variable that holds `name`, for the manifest's `seed` field. */
export const sepoliaVar = (name: SepoliaSecret): string => SEPOLIA_SECRETS[name];

/** The mnemonic or hex key for `name`; throws if the seed file lacks it. */
export const sepoliaSecret = (name: SepoliaSecret): string => envSeed(SEPOLIA_SECRETS[name]);
