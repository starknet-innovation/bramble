/**
 * A real vault service over in-memory storage, wired for QSB accounts the way
 * the background root wires it: one encrypted store per journal key through
 * `createQsbJournalStores`, with the same backend and options as the vault.
 * The journal-id drawer and the Krusty double are deterministic, every id is
 * a full 64-digit hex string and every phrase a full 24-word one, and the
 * backend records each key it writes so a suite can check the write order.
 */
import { createHash } from "node:crypto";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { FAKE_GENERATED_MNEMONIC_24, fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import type { QsbAccountRecord } from "@bramble/vault/qsb-account";
import { createQsbJournalStores, type QsbJournalStores } from "@bramble/vault/qsb-journal-stores";
import { emptyVault, type Vault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import type { WalletVaultService } from "@bramble/vault/service-types";

/** The vault password every QSB suite uses. */
export const PASSPHRASE = "correct horse battery staple";

/** The vault's own storage key. */
export const VAULT_KEY = "bramble:vault";

// The founding Starknet phrase of the harness vault (12 words).
const STARKNET_PHRASE =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

/** A real-shaped journal id: 32 bytes as 64 lowercase hex digits. */
export const journalIdFor = (label: string): string =>
  createHash("sha256").update(`qsb service journal ${label}`).digest("hex");

/** The storage key of one journal id. */
export const journalKeyOf = (journalId: string): string => `bramble:qsb-journal:${journalId}`;

/**
 * Options for {@link qsbServiceHarness}, by key. `phrases` are what Krusty
 * generates, in order (then the fake's own 24-word phrase); `journalIds` what
 * the drawer draws, in order (then ids derived from a counter); `kms`
 * overrides individual Krusty methods; `vault` is the stored vault (absent:
 * a vault holding only the founding Starknet phrase; null: no vault at all);
 * `wired: false` leaves the service without QSB wiring.
 */
export type QsbHarnessOptions = {
  readonly journalIds?: readonly string[];
  readonly kms?: Partial<KmsPort>;
  readonly phrases?: readonly string[];
  readonly vault?: Vault | null;
  readonly wired?: boolean;
};

/** A harness: the service, its backend, and what it wrote and drew. */
export type QsbHarness = {
  readonly backend: KeyValueStore;
  /** Makes every write to `key` throw until reset with null. */
  readonly failWritesTo: (key: string | null) => void;
  readonly generated: readonly number[];
  readonly journals: QsbJournalStores;
  readonly service: WalletVaultService;
  readonly storedQsbAccounts: () => Promise<readonly QsbAccountRecord[]>;
  /** Every key written since the service started; a suite may empty it. */
  readonly writes: string[];
};

/** A vault holding only the founding Starknet phrase. */
export const starknetVault = (): Vault => ({ ...emptyVault(), mnemonic: STARKNET_PHRASE });

/** Builds the harness; the stored vault is written before the service starts. */
export const qsbServiceHarness = async (options: QsbHarnessOptions = {}): Promise<QsbHarness> => {
  const memory = createMemoryStore();
  const writes: string[] = [];
  let failing: string | null = null;
  const backend: KeyValueStore = {
    get: (key) => memory.get(key),
    remove: (key) => memory.remove(key),
    async set(key, value) {
      if (key === failing) {
        throw new Error(`storage refused ${key}`);
      }
      writes.push(key);
      await memory.set(key, value);
    },
  };
  const vault = options.vault === undefined ? starknetVault() : options.vault;
  if (vault !== null) {
    await createEncryptedStore(backend, VAULT_KEY).write(vault, PASSPHRASE);
  }
  const phrases = [...(options.phrases ?? [])];
  const generated: number[] = [];
  const ids = [...(options.journalIds ?? [])];
  let drawn = 0;
  const drawJournalId = (): string => {
    drawn += 1;
    return ids.shift() ?? journalIdFor(`drawn ${drawn}`);
  };
  const journals = createQsbJournalStores((key) => createEncryptedStore(backend, key));
  const service = createWalletVaultService({
    encryptedStore: createEncryptedStore(backend, VAULT_KEY),
    kms: {
      ...fakeKms(),
      async generateMnemonic(wordCount?: number) {
        generated.push(wordCount ?? 12);
        return phrases.shift() ?? FAKE_GENERATED_MNEMONIC_24;
      },
      ...options.kms,
    },
    migrationStore: createEncryptedStore(backend, "bramble:vault-migration"),
    ...(options.wired === false
      ? {}
      : {
          qsb: {
            drawJournalId,
            journals,
          },
        }),
  });
  writes.length = 0;
  return {
    backend,
    failWritesTo: (key) => {
      failing = key;
    },
    generated,
    journals,
    service,
    storedQsbAccounts: async () => (await service.readVault(PASSPHRASE)).qsbAccounts,
    writes,
  };
};
