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
  // Bramble ladder: TA-01 (the bank and deployer), TA-02/03/06/08, multisig seat A.
  "S-BRM": "BRAMBLE_DATASET_SEED_S_BRM",
  // Script-made shapes on every ladder: TA-15…TA-26, TA-30, multisig seat B.
  "S-SCR": "BRAMBLE_DATASET_SEED_S_SCR",
  // Braavos ladder, script-deployed: TA-27…TA-29.
  "S-BRV": "BRAMBLE_DATASET_SEED_S_BRV",
  // Made in the Ready app (step 3); TA-12/13 run only once it is present.
  "S-RDY": "BRAMBLE_DATASET_SEED_S_RDY",
  // 15/18/21-word phrases on Bramble's ladder: TA-42…TA-44.
  "S-W15": "BRAMBLE_DATASET_SEED_S_W15",
  "S-W18": "BRAMBLE_DATASET_SEED_S_W18",
  "S-W21": "BRAMBLE_DATASET_SEED_S_W21",
  // Standalone hex keys: TA-05 OZ key, TA-08/TA-20 rotation targets, the
  // TA-12/13/15 guardian, TA-25 secp256k1 owner, TA-29 P-256 2FA signer, and
  // TA-07's key from `sncast account create --type oz`.
  "K-OZ": "BRAMBLE_DATASET_KEY_K_OZ",
  "K-ROT-O": "BRAMBLE_DATASET_KEY_K_ROT_O",
  "K-ROT-A": "BRAMBLE_DATASET_KEY_K_ROT_A",
  "K-GRD": "BRAMBLE_DATASET_KEY_K_GRD",
  "K-SECP": "BRAMBLE_DATASET_KEY_K_SECP",
  "K-P256": "BRAMBLE_DATASET_KEY_K_P256",
  "K-SNC": "BRAMBLE_DATASET_KEY_K_SNC",
} as const;

export type SepoliaSecret = keyof typeof SEPOLIA_SECRETS;

/** The seed-file variable that holds `name`, for the manifest's `seed` field. */
export const sepoliaVar = (name: SepoliaSecret): string => SEPOLIA_SECRETS[name];

/** The mnemonic or hex key for `name`; throws if the seed file lacks it. */
export const sepoliaSecret = (name: SepoliaSecret): string => envSeed(SEPOLIA_SECRETS[name]);
